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

const PYTHON_API_BASE = "http://127.0.0.1:8000/api";

// @desc    Fetch a generated exam payload
// @route   GET /api/exams/start
// @access  Private
const startExam = async (req, res) => {
  try {
    const InvitationRegistry = require("../models/InvitationRegistry");
    const RecruiterApplicant = require("../models/RecruiterApplicant");
    const Job = require("../models/Job");

    const isInvitedCandidate = req.user.origin === "recruiter_invited";

    // ── STRICT SINGLE-ATTEMPT GUARD FOR CANDIDATES ─────────────────────
    const existingExam = await Exam.findOne({
      candidateId: req.user._id,
      status: { $in: ["Completed", "Terminated", "Attended"] }
    });

    const existingResult = await VerificationResult.findOne({
      candidateId: req.user._id,
      status: { $in: ["Verified", "Failed", "Completed"] }
    });

    const existingApplicant = await RecruiterApplicant.findOne({
      $or: [
        { candidateUser: req.user._id },
        { extractedEmail: req.user.email },
        { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
      ],
      $or: [
        { status: "Completed" },
        { examStatus: { $in: ["Attended", "Completed", "Terminated", "Terminated - Proctoring Violation"] } },
        { examScore: { $exists: true, $ne: null } }
      ]
    });

    if (existingExam || existingResult || (isInvitedCandidate && existingApplicant && existingApplicant.examStatus !== "Pending")) {
      const finalScore = existingExam?.score ?? existingApplicant?.examScore ?? existingResult?.examScore ?? 0;
      return res.status(403).json({
        completed: true,
        message: "SINGLE_ATTEMPT_LIMIT_REACHED",
        error: "You have already completed your technical assessment. Retakes are strictly prohibited.",
        score: finalScore,
        status: existingResult?.status || existingApplicant?.status || "Completed"
      });
    }

    // ── Resolve invitation + applicant record ──────────────────────────
    const invitation = await InvitationRegistry.findOne({
      $or: [
        { email: req.user.email },
        { email: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
      ]
    });

    let applicant = null;
    if (invitation) {
      applicant = await RecruiterApplicant.findOne({
        recruiterId: invitation.recruiterId,
        jobId: invitation.jobId,
        $or: [
          { candidateUser: req.user._id },
          { extractedEmail: req.user.email },
          { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
        ]
      });
    }

    // Fallback: find any applicant linked directly to this user
    if (!applicant && isInvitedCandidate) {
      applicant = await RecruiterApplicant.findOne({
        $or: [
          { candidateUser: req.user._id },
          { extractedEmail: req.user.email },
          { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
        ]
      }).sort({ createdAt: -1 });
    }

    // ── Resolve job context ────────────────────────────────────────────
    let jobTargetSkills = [];
    let jobDifficulty = "intermediate";
    let jobTitle = "Senior Full Stack Software Engineer";
    let jobDescription = "Design, develop, and test scalable web applications and APIs.";

    const jobId = invitation?.jobId || applicant?.jobId || null;
    if (jobId) {
      const job = await Job.findById(jobId);
      if (job) {
        jobTargetSkills = (job.targetSkills || []).map(s => (typeof s === "string" ? s : s.skill || "")).filter(Boolean);
        jobDifficulty = job.difficulty || "intermediate";
        if (job.title) jobTitle = job.title;
        if (job.description) jobDescription = job.description;
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

    // ── Skill resolution: job skills ∪ resume/applicant skills ─────────
    const analysisSkills = (analysis?.claims?.skills || []).map(
      s => (typeof s === "string" ? s : s.name || s.skill || "")
    ).filter(Boolean);

    const applicantSkills = (applicant?.matchedSkills || applicant?.claimedSkills || []).map(
      s => (typeof s === "string" ? s : s.name || s.skill || "")
    ).filter(Boolean);

    const claimedSkills = analysisSkills.length > 0 ? analysisSkills : applicantSkills;
    const combinedSkills = [...new Set([...jobTargetSkills, ...claimedSkills])];

    // Ensure invited candidates always have at least the job skills to generate questions from
    const effectiveSkills = combinedSkills.length > 0
      ? combinedSkills
      : isInvitedCandidate
        ? ["Software Engineering", "Full Stack Development", "API Design", "Databases"]
        : ["Python", "SQL", "React", "Node.js", "MongoDB", "Git"];

    const formattedClaims = effectiveSkills.map((skill) => ({
      skill,
      context: (invitation || applicant) ? `Job Alignment Assessment (${jobTitle})` : "Practice Assessment",
    }));

    // ── Generate Assessment via Python AI Engine ────────────────────────
    let generatedMcqs = [];
    try {
      const pythonRes = await axios.post(
        `${PYTHON_API_BASE}/generate-assessment`,
        {
          claims: formattedClaims,
          difficulty: jobDifficulty,
          resume_description: resumeText,
          job_description: jobDescription,
          job_title: jobTitle,
        },
        { timeout: 8000 }
      );
      generatedMcqs = pythonRes.data.result?.mcq_questions || [];
    } catch (err) {
      console.warn(
        "[Python Proxy] Start Exam Error (using catalog fallback):",
        err.message,
      );
    }

    // Fallback catalog if AI engine offline or empty
    if (!generatedMcqs || !Array.isArray(generatedMcqs) || generatedMcqs.length === 0) {
      generatedMcqs = get30QuestionCatalog(effectiveSkills);
    }

    // ── Save exam to DB ────────────────────────────────────────────────
    const exam = await Exam.create({
      candidateId: req.user._id,
      topic: (invitation || applicant) ? "Job Alignment Assessment" : "Dynamic Practice Exam",
      skills: effectiveSkills,
      passingScore: 70,
      status: "In Progress",
      questions: generatedMcqs.map((q) => {
        const options = Array.isArray(q.options) ? q.options : ["Option A", "Option B", "Option C", "Option D"];
        const targetAns = q.correct_answer || q.correctAnswer || options[0];
        const correctIdx = options.indexOf(targetAns);
        return {
          questionText: q.question_text || q.question || "Technical Question",
          options,
          correctOption: correctIdx !== -1 ? correctIdx : 0,
          skill: q.skill || q.category || effectiveSkills[0] || "Technical",
        };
      }),
    });

    // Mark exam status as In Progress for this candidate on recruiter workspace
    await RecruiterApplicant.updateMany(
      {
        $or: [
          { candidateUser: req.user._id },
          { extractedEmail: req.user.email },
          { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
        ]
      },
      { examStatus: "In Progress" }
    );

    // ── Format for frontend UI ─────────────────────────────────────────
    const frontendQuestions = exam.questions.map((q) => ({
      _id: q._id,
      category: q.skill || effectiveSkills[0] || "General",
      difficulty: jobDifficulty,
      text: q.questionText,
      options: q.options,
    }));

    res.json(frontendQuestions);
  } catch (error) {
    console.error("Start Exam Error:", error.stack || error.message);
    res.status(500).json({ message: "Failed to generate exam questions." });
  }
};

// 30-Question Catalog Fallback Helper
const get30QuestionCatalog = (skills) => [
  {
    question:
      "What is the primary difference between a List and a Tuple in Python?",
    options: [
      "Lists are immutable, Tuples are mutable",
      "Lists are mutable, Tuples are immutable",
      "Tuples cannot store integers",
      "Lists require string keys",
    ],
    correctAnswer: "Lists are mutable, Tuples are immutable",
    skill: "Python",
  },
  {
    question: "Which keyword is used for exception handling cleanup in Python?",
    options: ["finally", "catch", "defer", "finish"],
    correctAnswer: "finally",
    skill: "Python",
  },
  {
    question: "What does the `__init__` method represent in Python classes?",
    options: [
      "Destructor",
      "Constructor",
      "Module Loader",
      "Static Initializer",
    ],
    correctAnswer: "Constructor",
    skill: "Python",
  },
  {
    question: "Which built-in module is used to handle JSON data in Python?",
    options: ["json", "pyjson", "serialize", "jackson"],
    correctAnswer: "json",
    skill: "Python",
  },
  {
    question: "What is the output of `len({1, 2, 2, 3})` in Python?",
    options: ["4", "3", "2", "Error"],
    correctAnswer: "3",
    skill: "Python",
  },

  {
    question: "Which SQL clause is used to filter aggregate query results?",
    options: ["WHERE", "HAVING", "GROUP BY", "ORDER BY"],
    correctAnswer: "HAVING",
    skill: "SQL",
  },
  {
    question:
      "Which JOIN returns all records from the left table and matched records from the right table?",
    options: ["INNER JOIN", "RIGHT JOIN", "LEFT JOIN", "FULL OUTER JOIN"],
    correctAnswer: "LEFT JOIN",
    skill: "SQL",
  },
  {
    question:
      "Which SQL constraint ensures all values in a column are distinct?",
    options: ["FOREIGN KEY", "UNIQUE", "NOT NULL", "CHECK"],
    correctAnswer: "UNIQUE",
    skill: "SQL",
  },
  {
    question: "What is the purpose of an INDEX in a database table?",
    options: [
      "Encrypt data",
      "Speed up data retrieval",
      "Enforce foreign keys",
      "Create table backups",
    ],
    correctAnswer: "Speed up data retrieval",
    skill: "SQL",
  },
  {
    question:
      "Which SQL statement is used to remove a table and its structure permanently?",
    options: ["DELETE TABLE", "DROP TABLE", "REMOVE TABLE", "TRUNCATE TABLE"],
    correctAnswer: "DROP TABLE",
    skill: "SQL",
  },

  {
    question:
      "Which hook is used to perform side effects in React functional components?",
    options: ["useState", "useMemo", "useEffect", "useCallback"],
    correctAnswer: "useEffect",
    skill: "React",
  },
  {
    question: "What is the Virtual DOM in React?",
    options: [
      "A lightweight in-memory representation of the real DOM",
      "A physical server component",
      "A replacement for HTML",
      "A browser extension",
    ],
    correctAnswer: "A lightweight in-memory representation of the real DOM",
    skill: "React",
  },
  {
    question:
      "How do you pass data down from a parent to a child component in React?",
    options: ["Props", "State", "Hooks", "Reducers"],
    correctAnswer: "Props",
    skill: "React",
  },
  {
    question: "What happens when a React component's state updates?",
    options: [
      "Page reloads",
      "Component re-renders",
      "Browser crashes",
      "State resets",
    ],
    correctAnswer: "Component re-renders",
    skill: "React",
  },
  {
    question:
      "Which hook should be used to optimize expensive computational functions?",
    options: ["useMemo", "useState", "useRef", "useContext"],
    correctAnswer: "useMemo",
    skill: "React",
  },

  {
    question: "What architecture pattern does Node.js use for concurrency?",
    options: [
      "Multi-threaded synchronous",
      "Single-threaded non-blocking Event Loop",
      "Process per request",
      "Shared memory concurrency",
    ],
    correctAnswer: "Single-threaded non-blocking Event Loop",
    skill: "Node.js",
  },
  {
    question: "Which core module is used to work with file paths in Node.js?",
    options: ["fs", "path", "url", "os"],
    correctAnswer: "path",
    skill: "Node.js",
  },
  {
    question: "What is `npm` in the Node.js ecosystem?",
    options: [
      "Node Performance Monitor",
      "Node Package Manager",
      "Node Process Model",
      "Network Protocol Method",
    ],
    correctAnswer: "Node Package Manager",
    skill: "Node.js",
  },
  {
    question:
      "Which mechanism is used in Express.js to process HTTP requests sequentially?",
    options: ["Middleware", "Streams", "Workers", "Sockets"],
    correctAnswer: "Middleware",
    skill: "Node.js",
  },
  {
    question: "Which built-in module allows creating HTTP servers in Node.js?",
    options: ["net", "http", "express", "server"],
    correctAnswer: "http",
    skill: "Node.js",
  },

  {
    question: "What format does MongoDB use to store data internally?",
    options: ["JSON", "BSON", "XML", "CSV"],
    correctAnswer: "BSON",
    skill: "MongoDB",
  },
  {
    question: "What is a document in MongoDB analogous to in a Relational DB?",
    options: ["Database", "Table", "Row", "Column"],
    correctAnswer: "Row",
    skill: "MongoDB",
  },
  {
    question:
      "Which command is used to query documents in a MongoDB collection?",
    options: ["find()", "select()", "fetch()", "query()"],
    correctAnswer: "find()",
    skill: "MongoDB",
  },
  {
    question:
      "What is the primary key field created automatically by MongoDB for every document?",
    options: ["id", "_id", "doc_id", "pk"],
    correctAnswer: "_id",
    skill: "MongoDB",
  },
  {
    question:
      "Which pipeline framework is used for advanced multi-stage data processing in MongoDB?",
    options: [
      "MapReduce",
      "Aggregation Pipeline",
      "Query Builder",
      "Stream Process",
    ],
    correctAnswer: "Aggregation Pipeline",
    skill: "MongoDB",
  },

  {
    question:
      "Which command is used to record staged changes into the local repository history?",
    options: ["git push", "git save", "git commit", "git add"],
    correctAnswer: "git commit",
    skill: "Git",
  },
  {
    question:
      "Which command creates a new Git branch and switches to it immediately?",
    options: [
      "git branch -new",
      "git checkout -b",
      "git switch -create",
      "git init",
    ],
    correctAnswer: "git checkout -b",
    skill: "Git",
  },
  {
    question: "What does `git fetch` do?",
    options: [
      "Downloads remote commits without merging",
      "Deletes uncommitted files",
      "Creates a pull request",
      "Reverts last commit",
    ],
    correctAnswer: "Downloads remote commits without merging",
    skill: "Git",
  },
  {
    question:
      "Which file is used to specify intentionally untracked files that Git should ignore?",
    options: [".gitconfig", ".gitignore", ".gitkeep", ".env"],
    correctAnswer: ".gitignore",
    skill: "Git",
  },
  {
    question: "Which command combines changes from one branch into another?",
    options: ["git merge", "git combine", "git join", "git push"],
    correctAnswer: "git merge",
    skill: "Git",
  },
];

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

    const { answers = [], code_snippet, behavioral_response } = req.body;

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: "Answers are required." });
    }

    // Lookup the dynamically generated exam
    const questionIds = answers
      .map((entry) => entry.questionId)
      .filter(Boolean);
    const exam = await Exam.findOne({ "questions._id": { $in: questionIds } });

    let correctCount = 0;
    let totalQuestions = answers.length;

    if (exam) {
      const questionMap = new Map(
        exam.questions.map((q) => [q._id.toString(), q.correctOption]),
      );
      answers.forEach(({ questionId, answerIndex }) => {
        if (questionMap.get(String(questionId)) === answerIndex) {
          correctCount += 1;
        }
      });
    }

    let score =
      totalQuestions > 0
        ? Math.round((correctCount / totalQuestions) * 100)
        : 0;

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
      await exam.save();
    }

    // Upsert VerificationResult & ResumeAnalysis for EVERY candidate type (Self-Registered, Invited, Recruiter)
    const InvitationRegistry = require("../models/InvitationRegistry");
    const RecruiterApplicant = require("../models/RecruiterApplicant");
    const matchedInvitation = await InvitationRegistry.findOne({
      $or: [
        { email: req.user.email },
        { email: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
      ]
    });
    const jobId = matchedInvitation?.jobId || null;

    let vResult = await VerificationResult.findOne({
      candidateId: req.user._id,
      ...(jobId ? { jobId } : {}),
    }).sort({ createdAt: -1 }) || await VerificationResult.findOne({ candidateId: req.user._id }).sort({ createdAt: -1 });

    const alignScore = vResult?.alignmentScore || 85;
    const compositeTrustScore = Math.min(100, Math.max(0, Math.round((alignScore * 0.4) + (score * 0.4) + 20)));

    if (vResult) {
      vResult.examScore = score;
      vResult.trustScore = compositeTrustScore;
      vResult.status = isPassed ? "Verified" : "Failed";
      if (!vResult.alignmentScore) vResult.alignmentScore = alignScore;
      if (jobId && !vResult.jobId) vResult.jobId = jobId;
      await vResult.save();
    } else {
      vResult = await VerificationResult.create({
        candidateId: req.user._id,
        jobId,
        examScore: score,
        alignmentScore: alignScore,
        trustScore: compositeTrustScore,
        status: isPassed ? "Verified" : "Failed",
        matchedSkills: exam?.skills || ["Software Engineering"],
        missingSkills: [],
      });
    }

    // Update ResumeAnalysis with verification & trust score
    await ResumeAnalysis.findOneAndUpdate(
      { candidateId: req.user._id },
      { status: "Analysis Complete", verificationScore: score, trustScore: compositeTrustScore },
      { upsert: true, new: true }
    );

    // Update User model trustScore & verificationScore
    if (user) {
      if (!user.skillProgress) user.skillProgress = {};
      user.skillProgress.trustScore = compositeTrustScore;
      user.skillProgress.verificationScore = score;
      user.skillProgress.completedAssessments = (user.skillProgress.completedAssessments || 0) + 1;
      user.pipelineStage = "verification_complete";
      await user.save();
    }

    // Sync RecruiterApplicant status, exam score, and trust score for recruiter workspace
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
        status: "Completed",
        candidateUser: req.user._id,
        examScore: score,
        examStatus: "Attended",
        reasoning: `Assessment completed. Score: ${score}%. Verification Verdict: ${isPassed ? 'VERIFIED' : 'NEEDS IMPROVEMENT'}. Composite Trust Score: ${compositeTrustScore}%.`
      }
    );

    // ── Post-Exam Emails ───────────────────────────────────────────────
    try {
      // Build failed question analysis list
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

      const scoreColor = isPassed ? "#34d399" : "#f87171";
      const verdict = isPassed ? "PASSED \u2705" : "NEEDS IMPROVEMENT \u274c";

      // ─ Email to candidate ───────────────────────────────────────────
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
    <p>You have completed your technical assessment. Here are your results:</p>
    <div style="background:#0d1226;border:1px solid #1a2040;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
      <div style="font-size:48px;font-weight:900;color:${scoreColor};">${score}%</div>
      <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-top:4px;">${verdict}</div>
      <div style="font-size:12px;color:#5a6478;margin-top:8px;">Passing threshold: 70% &bull; Questions: ${totalQuestions} &bull; Correct: ${correctCount}</div>
    </div>
    ${failedQuestions.length > 0 ? `
    <h3 style="color:#e8ecf4;font-size:14px;font-weight:700;margin-bottom:8px;">Areas for Improvement (${failedQuestions.length} question${failedQuestions.length !== 1 ? 's' : ''}):</h3>
    ${failedHtml}` : ""}
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Screen Everyone &middot; Catch the Fraud &middot; Prove the Honest</p>
  </div>
</body></html>`;

        await sendEmail({
          email: user.email,
          subject: `[VeriProof] Your Assessment Results: ${score}% — ${verdict}`,
          html: candidateHtml,
        }).catch((err) => console.warn("[PostExam] Candidate email failed:", err.message));
      }

      // ─ Notify recruiter immediately upon candidate exam completion ──
      const InvitationRegistry = require("../models/InvitationRegistry");
      const RecruiterApplicant = require("../models/RecruiterApplicant");
      const matchedInv = await InvitationRegistry.findOne({
        $or: [
          { email: req.user.email },
          { email: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
        ]
      });

      const recruiterId = matchedInv?.recruiterId;
      if (recruiterId) {
        await RecruiterApplicant.updateMany(
          {
            recruiterId,
            $or: [
              { candidateUser: req.user._id },
              { extractedEmail: req.user.email }
            ]
          },
          {
            status: "Completed",
            examScore: score,
            examStatus: "Attended",
            examCompletedAt: new Date(),
            examDigestPending: true,
            examFailedReasons: failedQuestions.map(fq => `[${fq.skill}] ${fq.question} → Correct: ${fq.correctAnswer}`),
          }
        );

        // Fetch recruiter email and notify
        const recruiterUser = await User.findById(recruiterId);
        if (recruiterUser?.email) {
          const recruiterHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:620px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Candidate Assessment Notification</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${recruiterUser.name || "Recruiter"}</strong>,</p>
    <p>Invited candidate <strong>${user.name || req.user.email}</strong> (${req.user.email}) has just completed their technical assessment on VeriProof.</p>
    <div style="background:#0d1226;border:1px solid #6b8aff;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
      <div style="font-size:44px;font-weight:900;color:${scoreColor};">${score}%</div>
      <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-top:4px;">${verdict}</div>
      <div style="font-size:12px;color:#5a6478;margin-top:8px;">Candidate score updated live in your Recruiter Pipeline.</div>
    </div>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Forensic Credential Intelligence</p>
  </div>
</body></html>`;

          await sendEmail({
            email: recruiterUser.email,
            subject: `[VeriProof Alert] Candidate ${user.name || req.user.email} completed assessment (${score}%)`,
            html: recruiterHtml,
          }).catch(err => console.warn("[PostExam] Recruiter notification email error:", err.message));
        }
      }
    } catch (emailErr) {
      console.warn("[PostExam] Email/digest error (non-fatal):", emailErr.message);
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

module.exports = {
  startExam,
  submitExam,
  getExamHistory,
};
