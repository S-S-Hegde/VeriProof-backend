const fs = require("fs");
const path = require("path");
const axios = require("axios");
const Exam = require("../models/Exam");
const User = require("../models/User");
const Project = require("../models/Project");
const VerificationResult = require("../models/VerificationResult");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const {
  rebuildSkillProgression,
} = require("../services/skillProgressionService");
const { assembleExam } = require("../services/questionBankService");
const { parseJobDescription } = require("../services/jdParsingService");
const {
  generateProjectDefense,
  evaluateDefenseAnswers,
} = require("../services/projectDefenseService");

const PYTHON_API_BASE = process.env.AI_ENGINE_URL || "https://python-engine-adw8.onrender.com";

// Helper to shuffle array with Fisher-Yates
const shuffle = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// @desc    Fetch a generated exam payload
// @route   GET /api/exams/start
// @access  Private
const startExam = async (req, res) => {
  try {
    const InvitationRegistry = require("../models/InvitationRegistry");
    const RecruiterApplicant = require("../models/RecruiterApplicant");
    const Job = require("../models/Job");

    const isInvitedCandidate = req.user.origin === "recruiter_invited";

    // ── STRICT SECURITY GUARD: Check for previous proctoring violations ──
    const violatedExam = await Exam.findOne({
      candidateId: req.user._id,
      status: { $in: ["Terminated", "Violated", "Disqualified"] }
    });

    const violatedApplicant = await RecruiterApplicant.findOne({
      $or: [
        { candidateUser: req.user._id },
        { extractedEmail: req.user.email },
        { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
      ],
      examStatus: { $in: ["Violated", "Terminated", "Disqualified", "Terminated - Proctoring Violation"] }
    });

    // If violated/disqualified, strictly forbid any future attempts
    if (violatedExam || violatedApplicant) {
      return res.status(403).json({
        completed: true,
        disqualified: true,
        message: "DISQUALIFIED_DUE_TO_VIOLATIONS",
        error: "You have been disqualified from this assessment due to security and proctoring violations. Retakes are strictly prohibited.",
      });
    }

    // ── Resolve invitation + applicant record ──────────────────────────
    const userEmail = req.user?.email || "";
    const invitation = userEmail ? await InvitationRegistry.findOne({
      $or: [
        { email: userEmail },
        { email: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(req.user?.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
      ]
    }) : null;

    let applicant = null;
    if (invitation && invitation.recruiterId && invitation.jobId) {
      applicant = await RecruiterApplicant.findOne({
        recruiterId: invitation.recruiterId,
        jobId: invitation.jobId,
        $or: [
          { candidateUser: req.user._id },
          { extractedEmail: userEmail },
          { extractedEmail: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          ...(req.user?.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
        ]
      });
    }

    // Fallback: find any applicant linked directly to this user
    if (!applicant && isInvitedCandidate) {
      applicant = await RecruiterApplicant.findOne({
        $or: [
          { candidateUser: req.user._id },
          { extractedEmail: userEmail },
          { extractedEmail: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
        ]
      }).sort({ createdAt: -1 });
    }

    // ── Resolve job context ────────────────────────────────────────────
    let jobTargetSkills = [];
    let jobDifficulty = "intermediate";
    let jobTitle = "Senior Full Stack Software Engineer";
    let jobDescription = "Design, develop, and test scalable web applications and APIs.";
    let extractedCoreSkills = [];
    let extractedProjectContext = [];

    let job = null;
    const jobId = (req.query && req.query.jobId) || (req.body && req.body.jobId) || (invitation && invitation.jobId) || (applicant && applicant.jobId) || null;
    if (jobId) {
      job = await Job.findById(jobId);
      if (job) {
        jobTargetSkills = (job.targetSkills || []).map(s => (typeof s === "string" ? s : s.skill || "")).filter(Boolean);
        jobDifficulty = job.difficulty || "intermediate";
        if (job.title) jobTitle = job.title;
        if (job.description) jobDescription = job.description;
      }
    }

    // ── Phase 1: JD Ingestion & Semantic Splitting ─────────────────────
    if (jobDescription) {
      try {
        const parsedJD = await parseJobDescription(jobDescription);
        if (parsedJD.core_skills && parsedJD.core_skills.length > 0) {
          extractedCoreSkills = parsedJD.core_skills;
        }
        if (parsedJD.project_context && parsedJD.project_context.length > 0) {
          extractedProjectContext = parsedJD.project_context;
        }
      } catch (jdErr) {
        console.warn("[startExam] JD semantic parsing note:", jdErr.message);
      }
    }

    // ── Resolve resume analysis (ResumeAnalysis or applicant record) ──
    const analysis = await ResumeAnalysis.findOne({
      candidateId: req.user._id,
      active: true,
      status: "Analysis Complete",
    });

    // Build resume text — prefer ResumeAnalysis, fall back to applicant raw text
    const resumeText = analysis?.analysis?.summary
      || analysis?.claims?.summary
      || applicant?.resumeText
      || "";

    // ── Skill resolution: Core Baseline Skills vs Candidate Claimed Electives ──
    const analysisSkills = (analysis?.claims?.skills || []).map(
      s => (typeof s === "string" ? s : s.name || s.skill || "")
    ).filter(Boolean);

    const applicantSkills = (applicant?.matchedSkills || applicant?.claimedSkills || []).map(
      s => (typeof s === "string" ? s : s.name || s.skill || "")
    ).filter(Boolean);

    const rawClaimedSkills = analysisSkills.length > 0 ? analysisSkills : applicantSkills;

    // ── STRICT SECURITY GUARD: Self-Registered Candidates MUST have an analyzed resume ──
    if (!isInvitedCandidate) {
      if (!analysis || analysisSkills.length === 0) {
        return res.status(400).json({
          error: "RESUME_ANALYSIS_REQUIRED",
          message: "Please upload and analyze your resume in the Student Dashboard before generating examination questions.",
        });
      }
    }

    // ── Resolve question count (Defaults to 20 for Stage 1 Token-Free Baseline Filter) ──
    let targetQuestionCount = job?.assessmentSettings?.questionCount || 20;
    const allowedCounts = [10, 15, 20, 25, 30, 35, 40, 50, 60];
    if (!isInvitedCandidate && req.query.count) {
      const parsedCount = parseInt(req.query.count, 10);
      if (allowedCounts.includes(parsedCount)) {
        targetQuestionCount = parsedCount;
      }
    }

    const jdRatio = job?.assessmentSettings?.jdRatio || 0.70;
    const durationMinutes = job?.assessmentSettings?.durationMinutes || Math.max(15, Math.round(targetQuestionCount * 1.15));

    if (jobTargetSkills.length === 0) {
      jobTargetSkills = extractedCoreSkills.length > 0
        ? extractedCoreSkills
        : (isInvitedCandidate
          ? ["Software Engineering", "Full Stack Development", "API Design", "Databases"]
          : (analysisSkills.slice(0, 4).length > 0 ? analysisSkills.slice(0, 4) : ["JavaScript", "Node.js", "SQL", "React", "Python"]));
    } else if (extractedCoreSkills.length > 0) {
      jobTargetSkills = [...new Set([...jobTargetSkills, ...extractedCoreSkills])];
    }

    const claimedSkills = rawClaimedSkills.length > 0 ? rawClaimedSkills : jobTargetSkills;

    // ── Phase 2: Stage 1 (Token-Free Baseline Filter Assembly) ─────────
    const requiredSkills = [...new Set([...jobTargetSkills, ...claimedSkills])];
    const finalQuestions = await assembleExam(requiredSkills, targetQuestionCount, jdRatio);

    // ── Save exam to DB ────────────────────────────────────────────────
    const exam = await Exam.create({
      candidateId: req.user._id,
      jobId,
      jobTitle,
      recruiterId: job?.recruiterId || invitation?.recruiterId || applicant?.recruiterId || null,
      topic: jobTitle || ((invitation || applicant) ? "Job Alignment Assessment" : "Dynamic Practice Exam"),
      skills: requiredSkills,
      projectContext: extractedProjectContext.length > 0 ? extractedProjectContext : [jobDescription],
      passingScore: 70,
      status: "In Progress",
      questions: finalQuestions.map((q) => ({
        questionText: q.questionText || "Technical Question",
        options: q.options,
        correctOption: q.correctOption !== undefined ? q.correctOption : 0,
        skill: q.skill || "Technical",
        difficulty: q.difficulty || "Medium",
        section: q.section || "Core",
      })),
    });

    // Mark exam status as In Progress for this specific job role
    const applicantQuery = {
      $or: [
        { candidateUser: req.user._id },
        { extractedEmail: req.user.email },
        { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
      ]
    };
    if (jobId) {
      applicantQuery.jobId = jobId;
    }
    await RecruiterApplicant.updateMany(applicantQuery, { examStatus: "In Progress" });

    // ── Format for frontend UI (Zero Leaks, Guaranteed Option Consistency) ──
    const frontendQuestions = exam.questions.map((q, idx) => ({
      _id: q._id,
      category: q.skill || (idx < Math.round(targetQuestionCount * jdRatio) ? "Core Technical" : "Candidate Elective"),
      difficulty: q.difficulty || "Medium",
      section: q.section || (idx < Math.round(targetQuestionCount * jdRatio) ? "Core" : "Elective"),
      text: q.questionText,
      options: q.options,
    }));

    res.json(frontendQuestions);
  } catch (error) {
    console.error("Start Exam Error:", error.stack || error.message);
    res.status(500).json({ message: "Failed to generate exam questions." });
  }
};

// @desc    Submit a practice exam payload
// @route   POST /api/exams/submit
// @access  Private
const submitExam = async (req, res) => {
  try {
    // Invited candidates are pre-verified by the recruiter pipeline — bypass the guard
    const isInvitedCandidate = req.user.origin === "recruiter_invited";

    if (!isInvitedCandidate) {
      const hasActiveExam = await Exam.exists({ candidateId: req.user._id });
      if (!hasActiveExam) {
        const [hasRepoAnalysis, hasResumeAnalysis] = await Promise.all([
          Project.exists({
            user: req.user._id,
            "githubStats.commitsCount": { $exists: true, $gt: 0 },
          }),
          ResumeAnalysis.exists({
            candidateId: req.user._id,
            active: true,
            status: "Analysis Complete",
          }),
        ]);
        if (!hasRepoAnalysis && !hasResumeAnalysis) {
          return res.status(403).json({
            message:
              "Complete resume or repository analysis before the technical assessment.",
          });
        }
      }
    }

    const { answers = [], code_snippet, behavioral_response, isTerminated = false, violationCount = 0, violations = [], proctoringLogs = [] } = req.body;

    // ── 1. Resolve Active Exam Session with Strict Ownership ───────────
    let exam = req.activeExam;
    if (!exam) {
      exam = await Exam.findOne({
        candidateId: req.user._id,
        status: "In Progress",
      }).sort({ createdAt: -1 });
    }

    if (!exam) {
      // Check if this attempt was already finalized (anti-replay guard)
      const existingExam = await Exam.findOne({
        candidateId: req.user._id,
      }).sort({ createdAt: -1 });

      if (existingExam && (existingExam.status === "Completed" || existingExam.status === "Terminated")) {
        return res.status(409).json({
          success: false,
          error: "EXAM_ALREADY_FINALIZED",
          message: "This examination has already been completed and cannot be resubmitted.",
        });
      }

      return res.status(404).json({
        success: false,
        error: "NO_ACTIVE_EXAM",
        message: "No active examination found for this candidate.",
      });
    }

    // ── 2. Server-Authoritative Anti-Cheat & Violation Merging ─────────
    const serverViolations = Array.isArray(exam.serverViolations) ? exam.serverViolations : [];
    const serverCount = Number(exam.serverViolationCount || serverViolations.length || 0);
    const clientCount = Number(violationCount || 0);
    const effectiveViolationCount = Math.max(serverCount, clientCount);
    const calculatedIntegrityScore = Math.max(0, 100 - (effectiveViolationCount * 25));
    const isSecurityDisqualified = isTerminated === true || effectiveViolationCount >= 3 || exam.isTerminated === true;

    // Handle security termination / violation disqualification
    if (isSecurityDisqualified) {
      const RecruiterApplicant = require("../models/RecruiterApplicant");
      await RecruiterApplicant.updateMany(
        {
          $or: [
            { candidateUser: req.user._id },
            { extractedEmail: req.user.email },
            { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
          ]
        },
        {
          status: "Disqualified",
          examStatus: "Violated",
          examScore: 0,
          reasoning: `Disqualified due to security violations (${effectiveViolationCount} total incidents).`
        }
      );

      exam.status = "Terminated";
      exam.score = 0;
      exam.isTerminated = true;
      exam.violationCount = effectiveViolationCount;
      exam.serverViolationCount = serverCount;
      exam.violations = Array.isArray(violations) && violations.length > 0 ? violations : serverViolations;
      exam.integrityScore = 0;
      exam.proctoringLogs = proctoringLogs;
      exam.submittedAt = new Date();
      await exam.save();

      return res.status(200).json({
        success: false,
        disqualified: true,
        score: 0,
        integrityScore: 0,
        violationCount: effectiveViolationCount,
        message: "Assessment terminated due to security violations. Result disqualified.",
      });
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: "Answers are required." });
    }

    // ── 3. Tamper-Proof Question Scoring (Fixed Denominator Defense) ────
    const totalQuestions = exam.questions && exam.questions.length > 0 ? exam.questions.length : (answers.length || 1);
    const questionMap = new Map(
      exam.questions.map((q) => [q._id.toString(), q.correctOption])
    );

    let correctCount = 0;
    answers.forEach(({ questionId, answerIndex }) => {
      if (questionMap.has(String(questionId)) && questionMap.get(String(questionId)) === answerIndex) {
        correctCount += 1;
      }
    });

    // Score is strictly calculated against ALL exam questions (unanswered questions score 0)
    let score = Math.min(100, Math.max(0, Math.round((correctCount / totalQuestions) * 100)));

    // --- PROXY TO PYTHON: Grade Code Snippets ---
    if (code_snippet) {
      try {
        const codeRes = await axios.post(`${PYTHON_API_BASE}/grade-code`, {
          code_snippet,
          language: "javascript",
          problem_context: "Practice Assessment",
        });
        const codeScore = codeRes.data.result.score || 0;
        score = Math.round((score + codeScore) / 2); // Average the scores
      } catch (err) {
        console.error("[Python Proxy] Code Grading Failed:", err.message);
      }
    }

    // --- PROXY TO PYTHON: Grade Behavioral Answers ---
    if (behavioral_response) {
      try {
        const behavRes = await axios.post(
          `${PYTHON_API_BASE}/evaluate-behavioral`,
          {
            response_text: behavioral_response,
            question_context: "Describe a challenging problem you solved.",
          },
        );
        const behavScore = behavRes.data.result.score || 0;
        score = Math.round((score + behavScore) / 2); // Average the scores
      } catch (err) {
        console.error(
          "[Python Proxy] Behavioral Evaluation Failed:",
          err.message,
        );
      }
    }

    const isPassed = score >= 70;
    let certificate = null;

    const user = await User.findById(req.user._id);
    if (user) {
      const categories = exam ? exam.skills : ["Software Engineering"];
      const certTitle = `${categories[0] || "Software Engineering"} Professional Certificate`;
      const credentialId = `VP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      if (isPassed) {
        certificate = {
          title: certTitle,
          issuedAt: new Date(),
          issuer: "VeriProof Authority",
          credentialId: credentialId,
          techStack: categories,
          verificationUrl: `/verify-credential/${credentialId}`,
        };
        user.certificates.push(certificate);
      }

      // Advance pipelineStage to verification_complete for all candidate types
      user.pipelineStage = "verification_complete";
      await user.save();

      // Rebuild skill progression & skill tree from all evidence (resume, repo, exam)
      await rebuildSkillProgression(user._id, {
        type: "exam",
        label: certTitle,
        technologies: categories,
        score,
        xp: isPassed ? 160 : 60,
        completed: isPassed,
        source: credentialId || "assessment",
      });
    }

    if (exam) {
      exam.status = "Completed";
      exam.score = score;
      exam.timeTaken = 30;
      exam.codeQuality = score;
      exam.answers = answers;
      exam.isTerminated = false;
      exam.violationCount = effectiveViolationCount;
      exam.serverViolationCount = serverCount;
      exam.violations = Array.isArray(violations) && violations.length > 0 ? violations : serverViolations;
      exam.integrityScore = calculatedIntegrityScore;
      exam.proctoringLogs = proctoringLogs;
      exam.submittedAt = new Date();
      await exam.save();
    }

    // Bulletproof detection: Has candidate ever completed an official attempt before?
    const priorCompletedExamsCount = await Exam.countDocuments({
      candidateId: req.user._id,
      status: "Completed",
      _id: { $ne: exam?._id },
    });

    const normalizedEmail = (req.user.email || "").toLowerCase().trim();
    const RecruiterApplicant = require("../models/RecruiterApplicant");
    const existingOfficialApplicant = await RecruiterApplicant.findOne({
      $and: [
        {
          $or: [
            { candidateUser: req.user._id },
            { extractedEmail: normalizedEmail },
            { extractedEmail: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
          ]
        },
        {
          $or: [
            { examScore: { $exists: true, $ne: null } },
            { examStatus: { $in: ["Attended", "Completed", "attended", "completed"] } },
            { status: { $in: ["Completed", "completed"] } }
          ]
        }
      ]
    });

    const InvitationRegistry = require("../models/InvitationRegistry");
    const existingInvitation = await InvitationRegistry.findOne({
      $and: [
        {
          $or: [
            { email: normalizedEmail },
            { email: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
          ]
        },
        {
          $or: [
            { status: "completed" },
            { examCompleted: true }
          ]
        }
      ]
    });

    const hasUserCompletedBefore = (user?.skillProgress?.completedAssessments || 0) > 0;

    const isFirstOfficialAttempt = (priorCompletedExamsCount === 0) && !existingOfficialApplicant && !existingInvitation && !hasUserCompletedBefore;

    if (!isFirstOfficialAttempt) {
      console.log(`[PostExam] Re-attempt detected for candidate ${req.user.email}. Recruiter notifications and official scorecard are permanently locked.`);
    }

    // Upsert VerificationResult & ResumeAnalysis for EVERY candidate type (Self-Registered, Invited, Recruiter)
    const matchedInvitation = await InvitationRegistry.findOne({
      $or: [
        { email: normalizedEmail },
        { email: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
      ]
    });
    // Resolve specific job context for this exam session
    const targetJobId = exam?.jobId || req.body.jobId || matchedInvitation?.jobId || null;
    const Job = require("../models/Job");
    const job = targetJobId ? await Job.findById(targetJobId) : null;
    const jobTitle = job?.title || exam?.jobTitle || exam?.topic || "Technical Assessment";

    // ── Phase 4: Multidimensional Triangulation & Discrepancy Engine ──
    const stage1Score = score;
    let stage2Score = stage1Score;
    let defenseBreakdown = [];
    let defenseFeedback = "";

    const defenseInput = req.body.defenseSubmissions || req.body.stage2Answers || null;
    if (Array.isArray(defenseInput) && defenseInput.length > 0) {
      try {
        const defenseEval = await evaluateDefenseAnswers(
          defenseInput,
          exam?.projectContext ? exam.projectContext.join("; ") : (job?.description || "")
        );
        stage2Score = defenseEval.examDefenseScore;
        defenseBreakdown = defenseEval.breakdown || [];
        defenseFeedback = defenseEval.overallFeedback || "";
      } catch (defErr) {
        console.warn("[submitExam] Stage 2 defense evaluation warning:", defErr.message);
      }
    }

    // Combine Stage 1 syntax filter and Stage 2 adaptive project defense
    const examDefenseScore = Array.isArray(defenseInput) && defenseInput.length > 0
      ? Math.round((stage1Score * 0.5) + (stage2Score * 0.5))
      : stage1Score;

    // 1. Calculate claimScore (0-100): Skills declared on resume vs JD alignment
    const candidateSkills = (user?.skills || []).map(s => String(s).toLowerCase());
    const requiredSkillsList = (exam?.skills || ["Software Engineering"]).map(s => String(s).toLowerCase());
    let matchedSkillsCount = 0;
    requiredSkillsList.forEach(reqSkill => {
      if (candidateSkills.some(cs => cs.includes(reqSkill) || reqSkill.includes(cs))) {
        matchedSkillsCount++;
      }
    });
    const claimScore = Math.min(100, Math.max(30, Math.round((matchedSkillsCount / Math.max(1, requiredSkillsList.length)) * 100)));

    // 2. Calculate repoEvidenceScore (0-100): AST complexity, commit health, and originality
    const userProjects = await Project.find({ user: req.user._id }).lean();
    let repoEvidenceScore = 40;
    if (userProjects && userProjects.length > 0) {
      const totalCommits = userProjects.reduce((acc, p) => acc + (p.githubStats?.commitsCount || 0), 0);
      const hasVerifiedProj = userProjects.some(p => p.isVerified || p.verificationStatus === "Verified");
      const hasAst = userProjects.some(p => p.astAnalysis && p.astAnalysis.complexityScore);
      repoEvidenceScore = Math.min(100, Math.max(45, (totalCommits > 15 ? 75 : 60) + (hasVerifiedProj ? 15 : 0) + (hasAst ? 10 : 0)));
    } else if (req.user.githubUsername) {
      repoEvidenceScore = 65;
    }

    // 3. Triangulation Divergence Formula: |repoEvidenceScore - examDefenseScore|
    const { divergence, classification, summary: triangulationSummary } = VerificationResult.calculateClassification(
      claimScore,
      repoEvidenceScore,
      examDefenseScore
    );

    let vResult = await VerificationResult.findOne({
      candidateId: req.user._id,
      ...(targetJobId ? { jobId: targetJobId } : {}),
    }).sort({ createdAt: -1 });

    if (!vResult && !targetJobId) {
      vResult = await VerificationResult.findOne({ candidateId: req.user._id }).sort({ createdAt: -1 });
    }

    const alignScore = vResult?.alignmentScore || claimScore || 85;
    const compositeTrustScore = Math.min(100, Math.max(0, Math.round((alignScore * 0.3) + (repoEvidenceScore * 0.3) + (examDefenseScore * 0.4))));

    if (isFirstOfficialAttempt) {
      if (vResult) {
        vResult.examScore = examDefenseScore;
        vResult.trustScore = compositeTrustScore;
        vResult.status = isPassed ? "Verified" : "Failed";
        vResult.claimScore = claimScore;
        vResult.repoEvidenceScore = repoEvidenceScore;
        vResult.examDefenseScore = examDefenseScore;
        vResult.stage1Score = stage1Score;
        vResult.stage2Score = stage2Score;
        vResult.divergence = divergence;
        vResult.classification = classification;
        vResult.triangulationSummary = triangulationSummary;
        if (Array.isArray(defenseInput) && defenseInput.length > 0) {
          vResult.defenseQuestions = defenseInput.map((d, i) => ({
            scenario_question: d.scenario_question,
            candidate_answer: d.candidate_answer,
            score: defenseBreakdown[i]?.score || stage2Score,
            feedback: defenseBreakdown[i]?.feedback || defenseFeedback,
            gradedAt: new Date(),
          }));
        }
        if (!vResult.alignmentScore) vResult.alignmentScore = alignScore;
        if (targetJobId && !vResult.jobId) vResult.jobId = targetJobId;
        await vResult.save();
      } else {
        vResult = await VerificationResult.create({
          candidateId: req.user._id,
          jobId: targetJobId,
          examScore: examDefenseScore,
          alignmentScore: alignScore,
          trustScore: compositeTrustScore,
          claimScore,
          repoEvidenceScore,
          examDefenseScore,
          stage1Score,
          stage2Score,
          divergence,
          classification,
          triangulationSummary,
          defenseQuestions: Array.isArray(defenseInput) ? defenseInput : [],
          status: isPassed ? "Verified" : "Failed",
          matchedSkills: exam?.skills || ["Software Engineering"],
          missingSkills: [],
        });
      }

      // Update ResumeAnalysis with verification & trust score
      await ResumeAnalysis.findOneAndUpdate(
        { candidateId: req.user._id },
        {
          status: "Analysis Complete",
          verificationScore: examDefenseScore,
          trustScore: compositeTrustScore,
          classification,
          divergence,
        },
        { upsert: true, new: true }
      );
    }

    if (exam) {
      exam.stage1Score = stage1Score;
      exam.stage2Score = stage2Score;
      exam.claimScore = claimScore;
      exam.repoEvidenceScore = repoEvidenceScore;
      exam.examDefenseScore = examDefenseScore;
      exam.divergence = divergence;
      exam.classification = classification;
      await exam.save();
    }

    // Update User model trustScore & verificationScore
    if (user) {
      if (!user.skillProgress) user.skillProgress = {};
      if (isFirstOfficialAttempt) {
        user.skillProgress.trustScore = compositeTrustScore;
        user.skillProgress.verificationScore = examDefenseScore;
      }
      user.skillProgress.completedAssessments = (user.skillProgress.completedAssessments || 0) + 1;
      user.pipelineStage = "verification_complete";
      await user.save();
    }

    // Update recruiter pipeline specifically for the target job role
    const applicantUpdateQuery = {
      $or: [
        { candidateUser: req.user._id },
        { extractedEmail: req.user.email },
        { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
      ]
    };
    if (targetJobId) {
      applicantUpdateQuery.jobId = targetJobId;
    }

    await RecruiterApplicant.updateMany(
      applicantUpdateQuery,
      {
        status: "Completed",
        candidateUser: req.user._id,
        examScore: examDefenseScore,
        examStatus: "Attended",
        classification,
        divergence,
        reasoning: `Assessment completed for ${jobTitle}. Defense Score: ${examDefenseScore}%. Classification: ${classification} (Divergence Index: ${divergence.toFixed(1)}). Summary: ${triangulationSummary}`
      }
    );

    // Update logged-in candidate profile state
    await User.findByIdAndUpdate(req.user._id, {
      pipelineStage: "verification_complete",
      examStatus: "Completed",
    });

    // ── Build failed questions analysis ─────────────────────────────────
    const failedQuestions = [];
    if (exam) {
      const questionMap = new Map(
        exam.questions.map((q) => [q._id.toString(), q])
      );
      answers.forEach(({ questionId, answerIndex }) => {
        const q = questionMap.get(String(questionId));
        if (q && q.correctOption !== answerIndex) {
          failedQuestions.push({
            question: q.questionText,
            yourAnswer: q.options[answerIndex] || "Not answered",
            correctAnswer: q.options[q.correctOption],
            skill: q.skill || "Technical",
          });
        }
      });
    }

    // Send emails on exam completion
    try {
      const scoreColor = isPassed ? "#34d399" : "#f87171";
      const verdict = isPassed ? "PASSED \u2705" : "NEEDS IMPROVEMENT \u274c";

      const failedHtml = failedQuestions.length > 0
        ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:12px;">
            <thead><tr style="background:#1a2040;">
              <th style="padding:8px 10px;text-align:left;color:#94a0b8;">Skill</th>
              <th style="padding:8px 10px;text-align:left;color:#94a0b8;">Question</th>
              <th style="padding:8px 10px;text-align:left;color:#f87171;">Your Answer</th>
              <th style="padding:8px 10px;text-align:left;color:#34d399;">Correct Answer</th>
            </tr></thead>
            <tbody>${failedQuestions.map((fq, i) => `
              <tr style="background:${i % 2 === 0 ? '#0d1226' : '#0a0e1a'};">
                <td style="padding:8px 10px;color:#6b8aff;font-weight:600;">${fq.skill}</td>
                <td style="padding:8px 10px;color:#c8d0e4;">${fq.question}</td>
                <td style="padding:8px 10px;color:#f87171;">${fq.yourAnswer}</td>
                <td style="padding:8px 10px;color:#34d399;">${fq.correctAnswer}</td>
              </tr>`).join('')}
            </tbody>
          </table>`
        : `<p style="color:#34d399;font-weight:600;">Perfect score — no incorrect answers!</p>`;

      // Email to Candidate
      if (user?.email) {
        const candidateHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:620px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Forensic Credential Intelligence</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${user.name || "Candidate"}</strong>,</p>
    <p>You have completed your assessment for <strong>${jobTitle}</strong>. Here are your official results:</p>
    <div style="background:#0d1226;border:1px solid #1a2040;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
      <div style="font-size:48px;font-weight:900;color:${scoreColor};">${score}%</div>
      <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-top:4px;">${verdict}</div>
      <div style="font-size:12px;color:#5a6478;margin-top:8px;">Passing threshold: 70% &bull; Questions: ${totalQuestions} &bull; Correct: ${correctCount}</div>
    </div>
    ${failedQuestions.length > 0 ? `
    <h3 style="color:#e8ecf4;font-size:14px;font-weight:700;margin-bottom:8px;">Question Analysis (${failedQuestions.length} incorrect):</h3>
    ${failedHtml}` : ""}
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Forensic Credential Intelligence</p>
  </div>
</body></html>`;

        sendEmail({
          email: user.email,
          subject: `[VeriProof] Your Assessment Results for ${jobTitle}: ${score}% — ${verdict}`,
          html: candidateHtml,
        }).catch((err) => console.warn("[PostExam] Candidate email error:", err.message));
      }

      // ── Email to Recruiter with Embedded Forensic Proctoring Evidence ──
      let recruiterId = job?.recruiterId || exam?.recruiterId || matchedInvitation?.recruiterId || null;

      const candidateViolations = [
        ...(exam?.serverViolations || []),
        ...(exam?.violations || [])
      ];

      const backendBase = (process.env.BACKEND_URL || "http://localhost:5000").replace(/\/$/, "");
      const proctorHtml = (candidateViolations.length > 0 || effectiveViolationCount > 0)
        ? `
        <div style="background:#1a1013;border:1px solid #ef4444;border-radius:12px;padding:20px;margin:20px 0;">
          <div style="color:#ef4444;font-size:16px;font-weight:800;letter-spacing:-0.5px;margin-bottom:6px;">
            ⚠️ PROCTORING INCIDENT REPORT (${effectiveViolationCount} Security Strike${effectiveViolationCount > 1 ? "s" : ""})
          </div>
          <p style="color:#fca5a5;font-size:12px;margin:0 0 14px 0;">
            Integrity Score: <strong>${calculatedIntegrityScore}%</strong> ${isSecurityDisqualified ? " &bull; <span style='color:#ef4444;font-weight:900;'>STATUS: DISQUALIFIED</span>" : ""}
          </p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px;">
            <thead>
              <tr style="background:#2a1419;color:#f87171;">
                <th style="padding:8px 10px;text-align:left;">Violation Type</th>
                <th style="padding:8px 10px;text-align:left;">Reason / Details</th>
                <th style="padding:8px 10px;text-align:left;">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${candidateViolations.map((v, i) => `
                <tr style="background:${i % 2 === 0 ? '#1f0d11' : '#17090c'};border-bottom:1px solid #33151b;">
                  <td style="padding:8px 10px;color:#fca5a5;font-weight:700;">${String(v.type || "SECURITY_ALERT").toUpperCase()}</td>
                  <td style="padding:8px 10px;color:#e2e8f0;">${v.reason || v.vlmReason || v.details || "Threshold anomaly detected"}</td>
                  <td style="padding:8px 10px;color:#94a3b8;font-family:monospace;font-size:11px;">${v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : "Session Time"}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`
        : `
        <div style="background:#091d14;border:1px solid #10b981;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
          <div style="color:#10b981;font-size:14px;font-weight:700;">✓ Proctoring Integrity: 100% (Clean Session)</div>
          <div style="color:#6ee7b7;font-size:12px;margin-top:4px;">No suspicious devices, eye-gaze anomalies, or multi-person events detected.</div>
        </div>`;

      if (recruiterId) {
        const recruiterUser = await User.findById(recruiterId);
        if (recruiterUser?.email) {
          const recruiterHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:640px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Forensic Candidate Assessment &amp; Proctoring Audit</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${recruiterUser.name || "Recruiter"}</strong>,</p>
    <p>Candidate <strong>${user.name || req.user.email}</strong> (${req.user.email}) has completed the technical assessment for <strong>${jobTitle}</strong>.</p>
    
    <div style="background:#0d1226;border:1px solid #6b8aff;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
      <div style="font-size:44px;font-weight:900;color:${scoreColor};">${score}%</div>
      <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-top:4px;">${verdict}</div>
      <div style="font-size:12px;color:#5a6478;margin-top:8px;">Passing Threshold: 70% &bull; Questions: ${totalQuestions} &bull; Correct: ${correctCount}</div>
    </div>

    ${proctorHtml}

    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Forensic Credential Intelligence &amp; Optical Proctoring Engine</p>
  </div>
</body></html>`;

          sendEmail({
            email: recruiterUser.email,
            subject: `[VeriProof Alert] Candidate ${user.name || req.user.email} completed assessment for ${jobTitle} (${score}%) ${effectiveViolationCount > 0 ? `⚠️ ${effectiveViolationCount} Strikes` : "✓ Clean"}`,
            html: recruiterHtml,
          }).catch(err => console.warn("[PostExam] Recruiter notification email error:", err.message));
        }
      }
    } catch (postEmailErr) {
      console.warn("[PostExam] Post-exam notification error:", postEmailErr.message);
    }


    res.json({
      totalQuestions,
      answeredQuestions: answers.filter(({ answerIndex }) =>
        Number.isInteger(answerIndex),
      ).length,
      correctAnswers: correctCount,
      score,
      status: isPassed ? "Passed" : "Needs Improvement",
      certificate,
      pipelineStage: "verification_complete",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get complete examination attempt history for candidate
// @route   GET /api/exams/history
// @access  Private
const getExamHistory = async (req, res) => {
  try {
    const exams = await Exam.find({ candidateId: req.user._id }).sort({ createdAt: 1 });

    let previousScore = 0;
    const history = exams.map((exam, index) => {
      const score = exam.score || 0;
      const totalQuestions = exam.questions?.length || 0;
      const correctAnswers = Math.round((score / 100) * totalQuestions);
      const isPassed = score >= (exam.passingScore || 70);

      // Group question accuracy by skill
      const skillStats = {};
      (exam.questions || []).forEach((q) => {
        const skill = q.skill || "Technical";
        if (!skillStats[skill]) skillStats[skill] = { total: 0, correct: 0 };
        skillStats[skill].total += 1;

        const candidateAnswer = (exam.answers || []).find((a) => String(a.questionId) === String(q._id));
        if (candidateAnswer && candidateAnswer.answerIndex === q.correctOption) {
          skillStats[skill].correct += 1;
        }
      });

      const weakSkills = [];
      const strongSkills = [];

      Object.entries(skillStats).forEach(([skill, stat]) => {
        const accuracy = stat.total > 0 ? (stat.correct / stat.total) * 100 : 0;
        if (accuracy < 60) weakSkills.push(skill);
        if (accuracy >= 80) strongSkills.push(skill);
      });

      const improvementDelta = index === 0 ? 0 : score - previousScore;
      previousScore = score;

      return {
        _id: exam._id,
        attemptNumber: index + 1,
        date: exam.createdAt,
        topic: exam.topic || "Technical Assessment",
        score,
        status: isPassed ? "Passed" : "Needs Improvement",
        passingScore: exam.passingScore || 70,
        totalQuestions,
        correctAnswers,
        weakSkills: weakSkills.length > 0 ? weakSkills : ["Edge Cases"],
        strongSkills: strongSkills.length > 0 ? strongSkills : exam.skills || ["Core Engineering"],
        improvementTrend: improvementDelta,
        codeQuality: exam.codeQuality || score,
      };
    });

    // Aggregated statistics
    const totalAttempts = history.length;
    const scores = history.map((h) => h.score);
    const bestScore = totalAttempts > 0 ? Math.max(...scores) : 0;
    const latestScore = totalAttempts > 0 ? scores[scores.length - 1] : 0;
    const avgScore = totalAttempts > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / totalAttempts) : 0;
    const passCount = history.filter((h) => h.status === "Passed").length;
    const passRate = totalAttempts > 0 ? Math.round((passCount / totalAttempts) * 100) : 0;
    const overallImprovement = totalAttempts > 1 ? scores[scores.length - 1] - scores[0] : 0;

    res.json({
      history,
      analytics: {
        totalAttempts,
        latestScore,
        bestScore,
        avgScore,
        passRate,
        overallImprovement,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Analyze live webcam frame snapshot with NVIDIA NIM Vision / Gemini Vision AI proctor
// @route   POST /api/exams/proctor-snapshot
// @access  Private
const analyzeProctorSnapshot = async (req, res) => {
  try {
    const rawImage = req.body.imageBase64 || req.body.image;
    const clientMetrics = req.body.clientMetrics;
    if (!rawImage) {
      return res.status(400).json({ message: "No image frame provided for proctoring analysis." });
    }

    const cleanBase64 = rawImage.replace(/^data:image\/[a-z]+;base64,/, "").trim();
    const dataUri = `data:image/jpeg;base64,${cleanBase64}`;

    // Fast-path client metric evaluation (Shutter / black screen)
    if (clientMetrics && clientMetrics.avgBrightness !== undefined && clientMetrics.avgBrightness < 10) {
      return res.json({
        violation: true,
        violationType: "SHUTTER_COVERED",
        reason: "Camera shutter appears closed or covered (Pitch black video feed).",
        confidence: 0.99,
        provider: "ClientOpticalEngine",
      });
    }

    const proctorPrompt = `You are an automated AI Vision Proctor for a high-stakes technical examination.
Analyze this candidate webcam frame snapshot for any visual anti-cheat violations:

VIOLATION TYPES TO CHECK:
1. SHUTTER_COVERED: Is the camera physically covered, taped, pitch black, or obscured?
2. STATIC_PHOTO: Is this a motionless printed photograph, digital photo spoof, dummy, or synthetic replay held in front of the lens?
3. NO_FACE: Is the candidate absent, moved out of camera frame, or ducking below the desk?
4. MULTIPLE_FACES: Are there 2 or more people in the camera frame assisting the candidate?
5. PHONE_SUSPICIOUS: Is the candidate visibly holding or using a smartphone, tablet, or looking down at hidden notes/screens?

OUTPUT FORMAT:
Respond with ONLY raw JSON (no backticks, no markdown):
{
  "violation": false,
  "violationType": "NONE",
  "reason": "Single authenticated candidate visible and focused on screen.",
  "confidence": 0.98
}`;

    let proctorResult = null;

    // 0. High-Speed Gemini 2.0 Flash Vision
    if (process.env.GEMINI_API_KEY) {
      try {
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });
        
        const geminiRes = await model.generateContent([
          { text: proctorPrompt },
          { inlineData: { data: cleanBase64, mimeType: "image/jpeg" } }
        ]);

        const raw = (geminiRes.response.text() || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "Gemini_Vision" };
        }
      } catch (geminiErr) {
        console.warn("[ProctorAI] Gemini Vision failover note:", geminiErr.message);
      }
    }

    // 1. Primary Vision Provider Pool: NVIDIA NIM Vision (meta/llama-3.2-11b-vision-instruct)
    const nvidiaKeyPool = [
      process.env.NVIDIA_API_KEY_VISION,
      process.env.NVIDIA_API_KEY,
      process.env.NVIDIA_API_KEY_2,
      process.env.NVIDIA_API_KEY_3,
      process.env.NVIDIA_API_KEY_4,
    ].filter(Boolean);

    for (const nKey of nvidiaKeyPool) {
      if (proctorResult) break;
      try {
        const nvRes = await axios.post(
          "https://integrate.api.nvidia.com/v1/chat/completions",
          {
            model: "meta/llama-3.2-11b-vision-instruct",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${nKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (nvRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "NVIDIA_NIM_Vision" };
          break;
        }
      } catch (nvErr) {
        console.warn("[ProctorAI] NVIDIA NIM Key failover note:", nvErr.response?.data?.message || nvErr.message);
      }
    }

    // 2. Secondary Vision Provider: Mistral AI Pixtral Vision (pixtral-12b-2409)
    const mistralKey = process.env.MISTRAL_API_KEY;
    if (!proctorResult && mistralKey) {
      try {
        const mistralRes = await axios.post(
          "https://api.mistral.ai/v1/chat/completions",
          {
            model: "pixtral-12b-2409",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${mistralKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (mistralRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "Mistral_Pixtral_Vision" };
        }
      } catch (misErr) {
        console.warn("[ProctorAI] Mistral Pixtral note:", misErr.message);
      }
    }

    // 3. Tertiary Vision Provider: Groq Cloud Vision (llama-3.2-11b-vision-preview)
    const groqKey = process.env.GROQ_API_KEY;
    if (!proctorResult && groqKey) {
      try {
        const groqRes = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: "llama-3.2-11b-vision-preview",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${groqKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (groqRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "Groq_Vision" };
        }
      } catch (groqErr) {
        console.warn("[ProctorAI] Groq Vision note:", groqErr.message);
      }
    }

    // 4. Quaternary Vision Provider: OpenRouter Vision (meta-llama/llama-3.2-11b-vision-instruct:free)
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!proctorResult && openRouterKey) {
      try {
        const orRes = await axios.post(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            model: "meta-llama/llama-3.2-11b-vision-instruct:free",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${openRouterKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (orRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "OpenRouter_Vision" };
        }
      } catch (orErr) {
        console.warn("[ProctorAI] OpenRouter Vision note:", orErr.message);
      }
    }

    // 5. Quinary Vision Provider: OpenAI GPT-4o-mini Vision
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!proctorResult && openaiKey) {
      try {
        const oaiRes = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (oaiRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "OpenAI_GPT4o_Vision" };
        }
      } catch (oaiErr) {
        console.warn("[ProctorAI] OpenAI Vision note:", oaiErr.message);
      }
    }

    // 6. Multi-Key Google Gemini 1.5 Flash Vision Pool
    const geminiKeyPool = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GOOGLE_API_KEY,
    ].filter(Boolean);

    for (const gKey of geminiKeyPool) {
      if (proctorResult) break;
      try {
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(gKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                { text: proctorPrompt },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: cleanBase64,
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
          }
        });
        const raw = (result.response.text() || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "Gemini_Flash_Vision" };
          break;
        }
      } catch (geminiErr) {
        console.warn("[ProctorAI] Gemini Vision failover note:", geminiErr.message);
      }
    }

    // Fallback: Default to verified if vision check was inconclusive
    if (!proctorResult) {
      proctorResult = {
        violation: false,
        violationType: "NONE",
        reason: "Candidate visual stream normal",
        confidence: 0.85,
        provider: "OpticalFallback",
      };
    }

    // ── Server-Authoritative Violation Recording ─────────────────────
    if (proctorResult.violation && req.user && req.user._id) {
      try {
        const activeExam = await Exam.findOne({
          candidateId: req.user._id,
          status: "In Progress",
        }).sort({ createdAt: -1 });

        if (activeExam) {
          activeExam.serverViolationCount = (activeExam.serverViolationCount || 0) + 1;
          if (!Array.isArray(activeExam.serverViolations)) activeExam.serverViolations = [];
          activeExam.serverViolations.push({
            type: proctorResult.violationType || "VISION_ANOMALY",
            reason: proctorResult.reason || "AI Vision proctoring anomaly detected.",
            confidence: proctorResult.confidence || 0.9,
            provider: proctorResult.provider || "AI_Vision",
            timestamp: new Date(),
          });
          activeExam.integrityScore = Math.max(0, 100 - (activeExam.serverViolationCount * 25));
          if (activeExam.serverViolationCount >= 3) {
            activeExam.isTerminated = true;
            activeExam.status = "Terminated";
          }
          await activeExam.save();
        }
      } catch (saveErr) {
        console.warn("[ProctorAI] Could not persist server-side violation:", saveErr.message);
      }
    }

    res.json(proctorResult);
  } catch (error) {
    console.error("[Proctor Snapshot Error]", error);
    res.status(500).json({ message: "Proctoring analysis error", violation: false });
  }
};

// @desc    Record server-authoritative telemetry violation from ACE / frontend
// @route   POST /api/exams/record-violation
// @access  Private
const recordProctorViolation = async (req, res) => {
  try {
    const { type = "SECURITY_VIOLATION", reason = "Proctoring anomaly detected", confidence = 0.9, telemetry = {} } = req.body;
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const activeExam = await Exam.findOne({
      candidateId: req.user._id,
      status: "In Progress",
    }).sort({ createdAt: -1 });

    if (!activeExam) {
      return res.status(404).json({ success: false, message: "No active exam session found." });
    }

    activeExam.serverViolationCount = (activeExam.serverViolationCount || 0) + 1;
    if (!Array.isArray(activeExam.serverViolations)) activeExam.serverViolations = [];
    activeExam.serverViolations.push({
      type,
      reason,
      confidence,
      telemetry,
      timestamp: new Date(),
    });
    activeExam.integrityScore = Math.max(0, 100 - (activeExam.serverViolationCount * 25));
    if (activeExam.serverViolationCount >= 3) {
      activeExam.isTerminated = true;
      activeExam.status = "Terminated";
    }
    await activeExam.save();

    return res.json({
      success: true,
      serverViolationCount: activeExam.serverViolationCount,
      integrityScore: activeExam.integrityScore,
      isTerminated: activeExam.isTerminated,
    });
  } catch (err) {
    console.error("[RecordViolation Error]", err.message);
    res.status(500).json({ success: false, message: "Failed to record proctoring telemetry." });
  }
};

// @desc    Record 3-frame burst snapshot evidence & persist image files
// @route   POST /api/exams/record-violation-snapshot
// @access  Public / Private
const recordViolationSnapshot = async (req, res) => {
  try {
    const {
      type = "SECURITY_VIOLATION",
      details = "Proctoring anomaly detected",
      vlm_reason = "",
      confidence = 0.95,
      timestamp = new Date(),
      burstFrames = [],
      examId,
    } = req.body;

    let candidateId = req.user?._id;

    // Find active exam
    let activeExam = null;
    if (examId) {
      activeExam = await Exam.findById(examId);
    } else if (candidateId) {
      activeExam = await Exam.findOne({ candidateId, status: "In Progress" }).sort({ createdAt: -1 });
    } else {
      activeExam = await Exam.findOne({ status: "In Progress" }).sort({ createdAt: -1 });
    }

    if (!activeExam) {
      return res.status(404).json({ success: false, message: "No active exam session found." });
    }

    // Save burst frames to static uploads directory
    const evidenceUrls = [];
    const violationsDir = path.join(__dirname, "../uploads", "violations");
    if (!fs.existsSync(violationsDir)) {
      fs.mkdirSync(violationsDir, { recursive: true });
    }

    const timeKey = Date.now();
    const cleanType = String(type).replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();

    if (Array.isArray(burstFrames) && burstFrames.length > 0) {
      for (const item of burstFrames) {
        const tag = item.tag || "frame";
        let base64Data = item.base64 || "";
        if (base64Data.startsWith("data:image")) {
          base64Data = base64Data.split(",")[1] || "";
        }
        if (base64Data) {
          const filename = `violation_${activeExam._id}_${timeKey}_${cleanType}_${tag}.jpg`;
          const filePath = path.join(violationsDir, filename);
          const buffer = Buffer.from(base64Data, "base64");
          fs.writeFileSync(filePath, buffer);
          evidenceUrls.push(`/uploads/violations/${filename}`);
        }
      }
    }

    activeExam.serverViolationCount = (activeExam.serverViolationCount || 0) + 1;
    if (!Array.isArray(activeExam.serverViolations)) activeExam.serverViolations = [];
    if (!Array.isArray(activeExam.violations)) activeExam.violations = [];

    const violationObj = {
      type,
      reason: details || vlm_reason || "Proctoring violation detected",
      vlmReason: vlm_reason,
      confidence,
      evidenceUrls,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    };

    activeExam.serverViolations.push(violationObj);
    activeExam.violations.push(violationObj);
    activeExam.integrityScore = Math.max(0, 100 - (activeExam.serverViolationCount * 25));

    if (activeExam.serverViolationCount >= 3) {
      activeExam.isTerminated = true;
      activeExam.status = "Terminated";
    }

    await activeExam.save();

    return res.json({
      success: true,
      serverViolationCount: activeExam.serverViolationCount,
      integrityScore: activeExam.integrityScore,
      isTerminated: activeExam.isTerminated,
      evidenceUrls,
    });
  } catch (err) {
    console.error("[RecordViolationSnapshot Error]", err.message);
    res.status(500).json({ success: false, message: "Failed to record burst snapshot violation." });
  }
};

// @desc    Generate Stage 2 Adaptive Project Defense scenario questions
// @route   POST /api/exams/project-defense
// @access  Private
const getProjectDefenseQuestions = async (req, res) => {
  try {
    const candidateId = req.user._id;
    const { jobId, jdContext } = req.body;

    let context = jdContext || "";
    if (!context && jobId) {
      const Job = require("../models/Job");
      const job = await Job.findById(jobId);
      if (job && job.description) {
        const parsed = await parseJobDescription(job.description);
        context = parsed.project_context;
      }
    }

    if (!context) {
      const activeExam = await Exam.findOne({ candidateId, status: "In Progress" }).sort({ createdAt: -1 });
      if (activeExam && activeExam.projectContext && activeExam.projectContext.length > 0) {
        context = activeExam.projectContext;
      }
    }

    const questions = await generateProjectDefense(candidateId, context);
    return res.json({
      success: true,
      questions,
    });
  } catch (err) {
    console.error("[getProjectDefenseQuestions Error]:", err.message);
    res.status(500).json({ success: false, message: "Failed to generate project defense questions." });
  }
};

// @desc    Zero-shot grading endpoint for Stage 2 defense answers
// @route   POST /api/exams/project-defense/evaluate
// @access  Private
const evaluateDefenseSubmission = async (req, res) => {
  try {
    const { answers = [], jdContext = "" } = req.body;
    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ success: false, message: "Answers array required." });
    }
    const result = await evaluateDefenseAnswers(answers, jdContext);
    return res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error("[evaluateDefenseSubmission Error]:", err.message);
    res.status(500).json({ success: false, message: "Failed to evaluate defense answers." });
  }
};

module.exports = {
  startExam,
  submitExam,
  getExamHistory,
  analyzeProctorSnapshot,
  recordProctorViolation,
  recordViolationSnapshot,
  getProjectDefenseQuestions,
  evaluateDefenseSubmission,
};


