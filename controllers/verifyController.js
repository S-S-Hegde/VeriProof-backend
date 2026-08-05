const asyncHandler = require("express-async-handler");
const axios = require("axios");
const Job = require("../models/Job");
const VerificationResult = require("../models/VerificationResult");
const Exam = require("../models/Exam");
const User = require("../models/User");
const Project = require("../models/Project");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const RecruiterApplicant = require("../models/RecruiterApplicant");
const InvitationRegistry = require("../models/InvitationRegistry");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");

const {
  analyzeResumeBuffer,
  scoreAlignmentLocally,
} = require("../services/resumeIntelligenceService");

const { flatSkillCatalog } = require("../data/skillCatalog");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract email from plain resume text via regex */
const extractEmailFromText = (text) => {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
};

/** Extract candidate name: first non-empty line that isn't an email / phone / url */
const extractNameFromText = (text) => {
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    if (line.length > 2 && line.length < 60 &&
        !line.match(/@/) && !line.match(/^[\d+\-()\s]{7,}$/) &&
        !line.match(/^https?:\/\//i)) {
      return line;
    }
  }
  return null;
};

/** Branded invitation email HTML */
const buildInviteEmail = ({ candidateName, recruiterName, jobTitle, registerUrl }) => ({
  subject: `[VeriProof] You've been invited to verify your credentials — ${jobTitle}`,
  html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:560px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">
      Forensic Credential Intelligence
    </p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${candidateName || "Candidate"}</strong>,</p>
    <p>
      <strong>${recruiterName}</strong> reviewed your resume for the role of
      <strong>${jobTitle}</strong> and has invited you to verify your credentials on VeriProof.
    </p>
    <p style="color:#94a0b8;">VeriProof is a forensic credential platform. By creating a profile and linking your evidence (GitHub, projects, certifications), you allow recruiters to independently verify your claims.</p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${registerUrl}" style="background:#6b8aff;color:#fff;font-weight:700;font-size:12px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:14px 32px;border-radius:8px;display:inline-block;">
        Create Your Profile
      </a>
    </div>
    <p style="color:#5a6478;font-size:12px;">If you were not expecting this, you can safely ignore this email.</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Screen Everyone · Catch the Fraud · Prove the Honest</p>
  </div>
</body>
</html>`,
});
const {
  rebuildSkillProgression,
} = require("../services/skillProgressionService");

const PYTHON_API_BASE = "http://127.0.0.1:8000/api";

// @desc    Parse Resume against Job description (Proxied to Python)
// @route   POST /api/verify/parse
// @access  Private (Recruiter)
const parseResume = asyncHandler(async (req, res) => {
  const { candidateId, jobId } = req.body;

  const job = await Job.findById(jobId);
  const candidate = await User.findById(candidateId);

  if (!job || !candidate) {
    res.status(404);
    throw new Error("Job or Candidate not found");
  }

  if (job.recruiterId.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("You can only parse resumes for your own job posts");
  }

  if (candidate.role !== "student") {
    res.status(400);
    throw new Error("Selected candidate must be a student profile");
  }

  const analysis = await ResumeAnalysis.findOne({
    candidateId,
    active: true,
    status: "Analysis Complete",
  });
  if (!analysis) {
    res.status(409);
    throw new Error(
      "The candidate's latest resume must finish analysis before screening.",
    );
  }

  let alignmentScore = 0;
  let verifiableMatched = 0;
  try {
    const pythonRes = await axios.post(`${PYTHON_API_BASE}/verify-claims`, {
      claims: analysis.claims.skills || [],
      job_requirements: job.targetSkills || [],
    }, { timeout: 12000 });
    alignmentScore    = pythonRes.data.result.score || 0;
    verifiableMatched = pythonRes.data.result.verifiable_claims_matched || 0;
  } catch (error) {
    // Python offline — use local keyword matcher
    const isConnErr = error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT";
    console.warn(isConnErr
      ? "[VerifyController] Python offline — using local alignment scorer"
      : `[VerifyController] Alignment error: ${error.message}`);
    alignmentScore    = scoreAlignmentLocally(analysis.claims.skills || [], job.targetSkills || []);
    verifiableMatched = alignmentScore > 0 ? Math.round((alignmentScore / 100) * (job.targetSkills?.length || 0)) : 0;
  }

  const status = "Pending Exam";

  const result = await VerificationResult.findOneAndUpdate(
    { candidateId, jobId },
    {
      $set: {
        candidateId,
        jobId,
        resumeText: analysis.truncatedText,
        sourceAnalysisId: analysis._id,
        alignmentScore: alignmentScore,
        matchedSkills: [],
        missingSkills: [],
        status,
      },
      $unset: { examScore: 1, examId: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const resultObj = result.toObject();
  resultObj.verifiable_claims_matched = verifiableMatched;

  res.status(201).json(resultObj);
});

// @desc    Get Exam for Candidate (Proxied to Python)
// @route   GET /api/verify/exam/:jobId
// @access  Private
const getExamForJob = asyncHandler(async (req, res) => {
  const verificationResult = await VerificationResult.findOne({
    candidateId: req.user._id,
    jobId: req.params.jobId,
  });

  if (!verificationResult) {
    res.status(404);
    throw new Error("No verification request found for this job");
  }

  let exam = verificationResult.examId
    ? await Exam.findById(verificationResult.examId)
    : null;

  if (!exam) {
    const job = await Job.findById(req.params.jobId);
    const skills = [
      ...new Set([
        ...(verificationResult.matchedSkills || []),
        ...(job?.targetSkills || []),
      ]),
    ];

    let generatedMcqs = [];
    try {
      const formattedClaims = skills.map((skill) => ({
        skill,
        context: "Required job skill",
      }));
      const pythonRes = await axios.post(
        `${PYTHON_API_BASE}/generate-assessment`,
        {
          claims:
            formattedClaims.length > 0
              ? formattedClaims
              : [{ skill: "Software Engineering", context: "General" }],
          difficulty: "intermediate",
        },
      );
      generatedMcqs = pythonRes.data.result.mcq_questions || [];
    } catch (error) {
      console.error("[Python Proxy] Exam Generation Failed:", error.message);
      res.status(500);
      throw new Error(
        "AI Engine failed to generate exam. Is the Python server running?",
      );
    }

    if (!generatedMcqs.length) {
      res.status(409);
      throw new Error("AI Engine returned empty questions. Please try again.");
    }

    exam = await Exam.create({
      verificationResultId: verificationResult._id,
      sourceAnalysisId: verificationResult.sourceAnalysisId,
      topic: job?.title || "Claim Verification",
      skills,
      passingScore: 70,
      questions: generatedMcqs.map((q) => {
        const correctIdx = q.options.indexOf(q.correct_answer);
        return {
          questionText: q.question_text,
          options: q.options,
          correctOption: correctIdx !== -1 ? correctIdx : 0,
        };
      }),
    });

    verificationResult.examId = exam._id;
    await verificationResult.save();
  }

  const candidateExam = {
    _id: exam._id,
    topic: exam.topic,
    passingScore: exam.passingScore,
    questions: exam.questions.map((q) => ({
      _id: q._id,
      questionText: q.questionText,
      options: q.options,
    })),
  };

  res.json(candidateExam);
});

// @desc    Submit Exam Answers
// @route   POST /api/verify/exam/:resultId
// @access  Private
const submitExam = asyncHandler(async (req, res) => {
  const { examId, answers } = req.body;

  const result = await VerificationResult.findById(req.params.resultId);
  const exam = await Exam.findById(examId);

  if (!result || !exam) {
    res.status(404);
    throw new Error("Result or Exam not found");
  }

  if (result.candidateId.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("You can only submit your own verification exam");
  }

  let correctCount = 0;
  exam.questions.forEach((q, index) => {
    if (answers[index] === q.correctOption) {
      correctCount++;
    }
  });

  const examScore = Math.round((correctCount / exam.questions.length) * 100);
  const newStatus = examScore >= exam.passingScore ? "Verified" : "Failed";

  result.examScore = examScore;
  result.status = newStatus;
  await result.save();

  await rebuildSkillProgression(result.candidateId, {
    type: "recruiter_assessment",
    label: `Recruiter exam: ${exam.topic}`,
    technologies: [exam.topic],
    score: examScore,
    xp: newStatus === "Verified" ? 170 : 65,
    completed: newStatus === "Verified",
    source: result._id.toString(),
  });

  res.json({ examScore, status: newStatus });
});

// @desc    Get Recruiter Verification Dashboard Data
// @route   GET /api/verify/results
// @access  Private (Recruiter)
const getRecruiterResults = asyncHandler(async (req, res) => {
  const jobs = await Job.find({ recruiterId: req.user._id });
  const jobIds = jobs.map((j) => j._id);

  const results = await VerificationResult.find({ jobId: { $in: jobIds } })
    .populate("candidateId", "name email profileImage")
    .populate("jobId", "title");

  res.json(results);
});

// @desc    Get Candidate Verification Dashboard Data
// @route   GET /api/verify/my-results
// @access  Private (Student)
const getCandidateResults = asyncHandler(async (req, res) => {
  const results = await VerificationResult.find({
    candidateId: req.user._id,
  }).populate("jobId", "title");
  res.json(results);
});

// @desc    Create a Job Role
// @route   POST /api/verify/job
// @access  Private (Recruiter)
const createJobRole = asyncHandler(async (req, res) => {
  const { title, description, targetSkills } = req.body;
  const sanitizedTargetSkills = (targetSkills || [])
    .map(s => (typeof s === "string" ? s : s.skill || ""))
    .filter(Boolean);
  const job = await Job.create({
    recruiterId: req.user._id,
    title,
    description,
    targetSkills: sanitizedTargetSkills,
  });
  res.status(201).json(job);
});

const getMyJobs = asyncHandler(async (req, res) => {
  const jobs = await Job.find({ recruiterId: req.user._id });
  res.json(jobs);
});

// @desc    Create Job from File (Proxied to Python AI)
// @route   POST /api/verify/job/from-file
// @access  Private (Recruiter)
const createJobFromFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("A PDF, DOCX, or TXT job description is required.");
  }

  try {
    const parsedData = await analyzeResumeBuffer(
      req.file.buffer,
      {
        mimeType: req.file.mimetype,
        fileName: req.file.originalname,
      },
    );


    const description = parsedData.normalizedText;

    if (!description) {
      res.status(400);
      throw new Error("No readable text was found in the document.");
    }

    const rawSkills = parsedData.claims?.skills || [];
    const targetSkills = rawSkills
      .map(s => (typeof s === "string" ? s : s.skill || ""))
      .filter(Boolean);

    const title = String(
      req.body.title || path.parse(req.file.originalname).name,
    ).trim();

    const job = await Job.create({
      recruiterId: req.user._id,
      title,
      description,
      targetSkills,
    });

    res.status(201).json(job);
  } catch (error) {
    res.status(500);
    throw new Error(`Document Processing Failed: ${error.message}`);
  }
});

const uploadApplicantResumes = asyncHandler(async (req, res) => {
  const job = await Job.findOne({ _id: req.body.jobId, recruiterId: req.user._id });
  if (!job) {
    res.status(404);
    throw new Error("Select one of your jobs before uploading resumes.");
  }
  if (!req.files?.length) {
    res.status(400);
    throw new Error("Select at least one resume.");
  }

  const uploadDir = path.join(__dirname, "..", "uploads", "recruiter-resumes");
  fs.mkdirSync(uploadDir, { recursive: true });

  const REGISTER_URL = process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL}/register`
    : "http://localhost:5173/register";

  const strictMode = req.body.strictMode === "true";
  const records = [];

  // ── Serial processing (free-tier Gemini: 15 req/min) ─────────────────────
  for (const file of req.files) {
    const extension = path.extname(file.originalname).toLowerCase();
    const filename = `${crypto.randomBytes(16).toString("hex")}${extension}`;
    const fileUrl = `/uploads/recruiter-resumes/${filename}`;
    fs.writeFileSync(path.join(uploadDir, filename), file.buffer);

    const applicant = await RecruiterApplicant.create({
      recruiterId: req.user._id,
      jobId: job._id,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      fileUrl,
    });

    try {
      const parsed = await analyzeResumeBuffer(
        file.buffer,
        { mimeType: file.mimetype, fileName: file.originalname, strictMode },
      );

      // ── Name + email: prefer Gemini extraction, fall back to regex ──
      const extractedEmail =
        parsed.analysis?.email ||
        extractEmailFromText(parsed.normalizedText);
      const extractedName =
        parsed.analysis?.name ||
        extractNameFromText(parsed.normalizedText) ||
        path.parse(file.originalname).name;

      // ── Alignment score (Python AI Engine with local fallback) ──
      let alignmentScore = 0;
      const resumeSkills = parsed.claims?.skills || [];
      const jobSkills = job.targetSkills || [];
      const resumeSkillStrings = resumeSkills
        .map(s => (typeof s === "string" ? s : s.skill || ""))
        .filter(Boolean);
      const resumeSet = new Set(resumeSkillStrings.map(s => s.toLowerCase()));

      try {
        const pythonRes = await axios.post(`${PYTHON_API_BASE}/verify-claims`, {
          claims: resumeSkills.map(s => (typeof s === "string" ? { skill: s, context: "Resume claim", source_quote: s } : s)),
          job_requirements: jobSkills,
        }, { timeout: 8000 });
        alignmentScore = pythonRes.data.result.score || 0;
      } catch (pythonErr) {
        alignmentScore = scoreAlignmentLocally(resumeSkills, jobSkills);
      }

      const matchedSkills = jobSkills.filter(s => resumeSet.has(s.toLowerCase()));
      const missingSkills = jobSkills.filter(s => !resumeSet.has(s.toLowerCase()));

      let reasoning = "";
      if (jobSkills.length === 0) {
        reasoning = "No target skills were specified on the job blueprint.";
      } else if (matchedSkills.length === jobSkills.length) {
        reasoning = `Excellent match (${alignmentScore}% score). Candidate covers all required target skills.`;
      } else if (matchedSkills.length === 0) {
        reasoning = `No matching target skills found (${alignmentScore}% score). Gaps: ${jobSkills.join(", ")}.`;
      } else {
        reasoning = `Matched ${matchedSkills.length} of ${jobSkills.length} target skills (${alignmentScore}% score). Strengths: ${matchedSkills.join(", ")}. Gaps: ${missingSkills.join(", ")}.`;
      }

      Object.assign(applicant, {
        status:        "Completed",
        resumeText:    parsed.normalizedText.substring(0, 20000),
        claims:        parsed.claims,
        analysis:      parsed.analysis,
        alignmentScore,
        matchedSkills,
        missingSkills,
        extractedName,
        extractedEmail: extractedEmail || "",
        reasoning,
        processedAt:   new Date(),
      });
      await applicant.save();

      // Register the candidate origin if an email was extracted
      if (extractedEmail) {
        await InvitationRegistry.findOneAndUpdate(
          { email: extractedEmail.toLowerCase().trim() },
          {
            email: extractedEmail.toLowerCase().trim(),
            recruiterId: req.user._id,
            jobId: job._id,
            status: "pending",
          },
          { upsert: true, new: true }
        );
      }

      records.push(applicant);

      // ── Send invitation email ──
      if (extractedEmail) {
        try {
          const { subject, html } = buildInviteEmail({
            candidateName: extractedName,
            recruiterName: req.user.name,
            jobTitle: job.title,
            registerUrl: REGISTER_URL,
          });
          await sendEmail({ email: extractedEmail, subject, html });
          applicant.emailSentTo  = extractedEmail;
          applicant.emailStatus  = "sent";
          console.log(`[Intake] Invite sent → ${extractedEmail}`);
        } catch (mailErr) {
          applicant.emailStatus = "failed";
          console.warn(`[Intake] Email failed for ${extractedEmail}:`, mailErr.message);
        }
      } else {
        applicant.emailStatus = "not_found";
      }
    } catch (err) {
      applicant.status = "Failed";
      applicant.error = err.message;
      applicant.processedAt = new Date();
    }

    records.push(await applicant.save());

    // ── Free-tier rate-limit buffer (800ms between files) ──
    if (req.files.indexOf(file) < req.files.length - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }

  res.status(201).json(records);
});

const getApplicantResumes = asyncHandler(async (req, res) => {
  const filter = { recruiterId: req.user._id };
  if (req.query.jobId) filter.jobId = req.query.jobId;
  const applicants = await RecruiterApplicant.find(filter)
    .populate("jobId", "title")
    .sort({ createdAt: -1 });

  // Map each applicant to check if candidate has registered and attended exam
  const populatedApplicants = await Promise.all(
    applicants.map(async (app) => {
      const obj = app.toObject();
      if (!obj.extractedEmail) {
        obj.examStatus = "Unregistered";
        obj.examScore = null;
        return obj;
      }

      const candidateUser = await User.findOne({ email: obj.extractedEmail.toLowerCase() });
      if (!candidateUser) {
        obj.examStatus = obj.emailStatus === "sent" ? "Not Attended" : "Unregistered";
        obj.examScore = null;
        return obj;
      }

      const vResult = await VerificationResult.findOne({ candidateId: candidateUser._id, jobId: obj.jobId?._id || obj.jobId });
      if (vResult && vResult.examScore !== undefined && vResult.examScore !== null) {
        obj.examStatus = "Attended";
        obj.examScore = vResult.examScore;
      } else if (vResult) {
        obj.examStatus = "In Progress";
        obj.examScore = null;
      } else {
        obj.examStatus = "Not Attended";
        obj.examScore = null;
      }

      return obj;
    })
  );

  res.json(populatedApplicants);
});

// @desc    Delete a job role (Blueprint)
// @route   DELETE /api/verify/job/:id
// @access  Private (Recruiter)
const deleteJob = asyncHandler(async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, recruiterId: req.user._id });
  if (!job) {
    res.status(404);
    throw new Error("Job not found or you are not the owner.");
  }
  await job.deleteOne();
  res.json({ message: "Blueprint deleted." });
});

// @desc    Delete an applicant record (Verdicts)
// @route   DELETE /api/verify/applicants/:id
// @access  Private (Recruiter)
const deleteApplicant = asyncHandler(async (req, res) => {
  const applicant = await RecruiterApplicant.findOne({
    _id: req.params.id,
    recruiterId: req.user._id,
  });

  if (!applicant) {
    res.status(404);
    throw new Error("Applicant not found or you are not the owner.");
  }

  await applicant.deleteOne();
  res.json({ message: "Applicant removed." });
});

// @desc    Run full End-to-End Candidate Verification Pipeline (Module 12)
// @route   POST /api/verify/candidate/:candidateId
// @access  Private (Recruiter)
const runFullVerificationPipeline = asyncHandler(async (req, res) => {
  const { candidateId } = req.params;
  const { force } = req.body;

  const applicant = await RecruiterApplicant.findById(candidateId).populate("jobId");
  if (!applicant) {
    res.status(404);
    throw new Error("Applicant not found");
  }

  if (applicant.v2Report && !force) {
    return res.json(applicant.v2Report);
  }

  const candidateEmail = applicant.extractedEmail;
  const candidateUser = candidateEmail ? await User.findOne({ email: candidateEmail.toLowerCase() }) : null;

  let repositories = [];
  let technical_assessment = null;
  let behavioral_assessment = null;
  let professional_experience_years = 0;

  if (candidateUser) {
    professional_experience_years = candidateUser.experienceYears || (candidateUser.role === "student" ? 0 : 3);
    
    const projects = await Project.find({ user: candidateUser._id });
    if (projects.length > 0) {
      repositories = projects.map(p => ({
        url: p.repositoryUrl || p.liveUrl || "",
        commits: p.analysis?.commitCount || 0,
        files: p.technologies || []
      }));
    }
    
    const exam = await Exam.findOne({ candidateId: candidateUser._id }).sort({ createdAt: -1 });
    if (exam && exam.status === "Completed") {
      technical_assessment = {
        score: exam.score || 0,
        time_taken_minutes: exam.timeTaken || 30,
        questions_attempted: exam.questions?.length || 10,
        code_quality_score: exam.codeQuality || (exam.score || 0)
      };
      
      behavioral_assessment = {
        answers: exam.answers || [],
        integrity_score: exam.integrityScore || 100,
      };
    }
  }

  const pipelineRequest = {
    job_requirements: applicant.jobId.targetSkills || ["Software Engineering"],
    resume_text: applicant.resumeText || applicant.extractedName || "Candidate Resume",
    repositories: repositories.length > 0 ? repositories : null,
    technical_assessment: technical_assessment,
    behavioral_assessment: behavioral_assessment,
    professional_experience_years: professional_experience_years
  };

  try {
    const pythonRes = await axios.post(`${PYTHON_API_BASE}/v2/verify-candidate`, pipelineRequest, { timeout: 45000 });
    
    applicant.v2Report = pythonRes.data;
    applicant.status = "Completed";
    await applicant.save();
    
    res.json(pythonRes.data);
  } catch (error) {
    const isConnErr = error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT";
    if (isConnErr) {
      res.status(503);
      throw new Error("Verification Engine is offline.");
    }
    res.status(500);
    throw new Error(error.response?.data?.detail || error.message);
  }
});

module.exports = {
  parseResume,
  getExamForJob,
  submitExam,
  getRecruiterResults,
  getCandidateResults,
  createJobRole,
  getMyJobs,
  createJobFromFile,
  uploadApplicantResumes,
  getApplicantResumes,
  deleteJob,
  deleteApplicant,
  runFullVerificationPipeline,
};
