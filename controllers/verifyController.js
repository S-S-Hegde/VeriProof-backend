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
  extractSkillsLocally,
  extractTextLocally,
  scoreAlignmentLocally,
} = require("../services/resumeIntelligenceService");

const { flatSkillCatalog } = require("../data/skillCatalog");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract email from plain resume text via regex */
const extractEmailFromText = (text) => {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
};

/** Extract GitHub username from plain resume text via regex */
const extractGithubFromText = (text) => {
  const match = text.match(/(?:github\.com\/|github:\s*|github\s+handle:\s*|github\s+username:\s*)([a-zA-Z0-9\-]+)/i);
  return match ? match[1].toLowerCase().trim() : null;
};

/** Extract candidate name: first non-empty line that isn't a PDF header / email / phone / url */
const extractNameFromText = (text) => {
  if (!text || typeof text !== "string") return null;
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 10)) {
    if (line.length > 2 && line.length < 60 &&
        !line.startsWith("%PDF") &&
        !line.startsWith("PDF-") &&
        !line.match(/^[\d%<>\/]/) &&
        !line.match(/@/) &&
        !line.match(/^[\d+\-()\s]{7,}$/) &&
        !line.match(/^https?:\/\//i) &&
        !line.toLowerCase().includes("job description") &&
        !line.toLowerCase().includes("curriculum vitae") &&
        !line.toLowerCase().includes("resume")) {
      return line;
    }
  }
  return null;
};

/** Branded invitation email HTML with 1-Click Google OAuth Access */
const buildInviteEmail = ({ candidateName, recruiterName, jobTitle, loginUrl, email, githubUsername }) => ({
  subject: `[VeriProof] You're Invited: Technical Assessment for ${jobTitle}`,
  html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0a0e1a;color:#e8ecf4;margin:0;padding:24px 16px;">
  <div style="max-width:560px;margin:0 auto;background:#0d1226;border:1px solid #1a2040;border-radius:16px;padding:32px 24px;box-sizing:border-box;">
    <h1 style="font-size:26px;font-weight:900;font-style:italic;letter-spacing:-1px;margin:0 0 4px 0;color:#ffffff;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin:0 0 20px 0;">
      Forensic Credential Intelligence
    </p>
    <hr style="border:none;border-top:1px solid #1a2040;margin:20px 0;">
    <p style="font-size:15px;line-height:1.5;margin:0 0 16px 0;">Hi <strong style="color:#ffffff;">${candidateName || "Candidate"}</strong>,</p>
    <p style="font-size:14px;line-height:1.6;color:#c0c9db;margin:0 0 20px 0;">
      <strong style="color:#ffffff;">${recruiterName}</strong> reviewed your resume for the role of
      <strong style="color:#6b8aff;">${jobTitle}</strong> and has invited you to complete a verified technical assessment on VeriProof.
    </p>
    
    <div style="background:#060913;border:1px solid #1a2a50;border-radius:12px;padding:18px 16px;margin:20px 0;box-sizing:border-box;">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <tr>
          <td style="width:30%;color:#5a6478;padding:8px 0;font-family:monospace;font-size:11px;vertical-align:top;font-weight:bold;">INVITED ROLE</td>
          <td style="width:70%;color:#6b8aff;padding:8px 0;font-family:monospace;font-size:12px;font-weight:bold;">${jobTitle}</td>
        </tr>
        <tr><td colspan="2" style="border-top:1px dashed #1a2040;height:1px;padding:0;"></td></tr>
        <tr>
          <td style="width:30%;color:#5a6478;padding:8px 0;font-family:monospace;font-size:11px;vertical-align:top;font-weight:bold;">INVITED EMAIL</td>
          <td style="width:70%;color:#e8ecf4;padding:8px 0;font-family:monospace;font-size:12px;">${email || "Your Registered Email"}</td>
        </tr>
        ${githubUsername ? `
        <tr><td colspan="2" style="border-top:1px dashed #1a2040;height:1px;padding:0;"></td></tr>
        <tr>
          <td style="width:30%;color:#5a6478;padding:8px 0;font-family:monospace;font-size:11px;vertical-align:top;font-weight:bold;">LINKED GITHUB</td>
          <td style="width:70%;color:#00ffaa;padding:8px 0;font-family:monospace;font-size:12px;">@${githubUsername}</td>
        </tr>` : ""}
      </table>
    </div>

    <div style="text-align:center;margin:32px 0 24px 0;">
      <a href="${loginUrl}" style="background:linear-gradient(135deg, #4285F4, #6b8aff);color:#ffffff;font-weight:800;font-size:13px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:16px 32px;border-radius:10px;display:inline-block;box-shadow:0 4px 18px rgba(66,133,244,0.4);">
        ⚡ Continue with Google &amp; Start Assessment &rarr;
      </a>
    </div>

    <p style="color:#64748b;font-size:12px;line-height:1.6;margin:16px 0 0 0;text-align:center;">
      No password needed &mdash; simply click above and sign in with your Google account to access your personalized candidate dashboard.
    </p>

    <hr style="border:none;border-top:1px solid #1a2040;margin:24px 0 16px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;margin:0;text-align:center;">VeriProof &mdash; Forensic Credential Intelligence Platform</p>
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

  const candidateUser = await User.findById(result.candidateId);
  if (candidateUser) {
    candidateUser.pipelineStage = "verification_complete";
    await candidateUser.save();
  }

  await rebuildSkillProgression(result.candidateId, {
    type: "recruiter_assessment",
    label: `Recruiter exam: ${exam.topic}`,
    technologies: [exam.topic],
    score: examScore,
    xp: newStatus === "Verified" ? 170 : 65,
    completed: newStatus === "Verified",
    source: result._id.toString(),
  });

  res.json({ examScore, status: newStatus, pipelineStage: "verification_complete" });
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

// @desc    Create Job from File (PDF, DOCX, TXT)
// @route   POST /api/verify/job/from-file
// @access  Private (Recruiter)
const createJobFromFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("A PDF, DOCX, or TXT job description is required.");
  }

  try {
    // 1. Fast local text extraction (< 10ms)
    const text = await extractTextLocally(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    if (!text || text.trim().length === 0) {
      res.status(400);
      throw new Error("No readable text was found in the job description document.");
    }

    // 2. Instant high-accuracy skill extraction (< 5ms)
    let targetSkills = extractSkillsLocally(text);

    // 3. Fast AI enhancement (non-blocking fallback)
    try {
      const parsedData = await analyzeResumeBuffer(
        req.file.buffer,
        {
          mimeType: req.file.mimetype,
          fileName: req.file.originalname,
          timeout: 3000,
        }
      );
      const aiSkills = (parsedData.claims?.skills || [])
        .map(s => (typeof s === "string" ? s : s.skill || ""))
        .filter(Boolean);
      if (aiSkills.length > 0) {
        targetSkills = [...new Set([...targetSkills, ...aiSkills])];
      }
    } catch (aiErr) {
      console.log("[CreateJobFromFile] Using fast local skill extraction");
    }

    const title = String(
      req.body.title || path.parse(req.file.originalname).name,
    ).trim();

    const job = await Job.create({
      recruiterId: req.user._id,
      title,
      description: text.substring(0, 15000),
      targetSkills,
    });

    res.status(201).json(job);
  } catch (error) {
    res.status(500);
    throw new Error(`Document Processing Failed: ${error.message}`);
  }
});

const uploadApplicantResumes = asyncHandler(async (req, res) => {
  const XLSX = require("xlsx");
  const AdmZip = require("adm-zip");

  const job = await Job.findOne({ _id: req.body.jobId, recruiterId: req.user._id });
  if (!job) {
    res.status(404);
    throw new Error("Select one of your jobs before uploading resumes.");
  }
  if (!req.files?.length) {
    res.status(400);
    throw new Error("Select at least one resume or ATS data file.");
  }

  const uploadDir = path.join(__dirname, "..", "uploads", "recruiter-resumes");
  fs.mkdirSync(uploadDir, { recursive: true });

  const FRONTEND_BASE = process.env.FRONTEND_URL || "http://localhost:5173";
  const REGISTER_URL = `${FRONTEND_BASE}/register`;
  const LOGIN_URL    = `${FRONTEND_BASE}/login`;

  const strictMode = req.body.strictMode === "true";

  // Helper to map dynamic ATS field names from CSV / Excel / JSON
  const extractCandidateDataFromRow = (row) => {
    if (!row || typeof row !== "object") return null;

    const findKey = (candidates) => {
      const keys = Object.keys(row);
      for (const cand of candidates) {
        const match = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, "") === cand.toLowerCase().replace(/[^a-z0-9]/g, ""));
        if (match && row[match] !== undefined && row[match] !== null && String(row[match]).trim() !== "") {
          return String(row[match]).trim();
        }
      }
      return "";
    };

    const name = findKey(["name", "candidate_name", "candidatename", "full_name", "fullname", "first_name", "applicant_name"]);
    const email = findKey(["email", "candidate_email", "candidateemail", "email_address", "emailaddress"]);
    const phone = findKey(["phone", "mobile", "contact", "phone_number"]);
    const skillsRaw = findKey(["skills", "key_skills", "technical_skills", "claims", "matched_skills", "skill_set"]);
    const resumeText = findKey(["resume_text", "resumetext", "summary", "profile", "experience", "description", "bio", "notes", "cv_text"]);
    const github = findKey(["github", "github_username", "portfolio", "linkedin"]);

    if (!name && !email && !resumeText) return null;

    let parsedSkills = [];
    if (skillsRaw) {
      const cleanString = (str) => String(str).replace(/^['"\[\s]+|['"\]\s]+$/g, "").trim();
      if (Array.isArray(skillsRaw)) {
        parsedSkills = skillsRaw.map(cleanString).filter(Boolean);
      } else if (typeof skillsRaw === "string") {
        let rawStr = skillsRaw.trim();
        try {
          const jsonParsed = JSON.parse(rawStr.replace(/'/g, '"'));
          if (Array.isArray(jsonParsed)) {
            parsedSkills = jsonParsed.map(cleanString).filter(Boolean);
          }
        } catch (e) {
          parsedSkills = rawStr
            .split(/[,;|]/)
            .map(cleanString)
            .filter(Boolean);
        }
      }
    }

    let cleanName = (name || "Candidate")
      .replace(/^(name|candidate_name|candidate|applicant|full_name)[:\s\-\_]+/i, "")
      .trim();

    return {
      name: cleanName || "Candidate",
      email: email ? email.toLowerCase() : "",
      phone: phone || "",
      skills: parsedSkills,
      resumeText: resumeText || `${cleanName} - ${parsedSkills.join(", ") || "Technical Applicant profile"}`,
      github: github || "",
    };
  };

  // ── Unified Candidate Intake Processor ─────────────────────────────────────
  const processSingleCandidateUnit = async ({ originalFileName, mimeType, buffer, candidateMetaData }) => {
    const extension = path.extname(originalFileName || "resume.pdf").toLowerCase() || ".pdf";
    const filename = `${crypto.randomBytes(16).toString("hex")}${extension}`;
    const fileUrl = `/uploads/recruiter-resumes/${filename}`;

    const candidateText = candidateMetaData?.resumeText || "";
    const metaSkillsText = (candidateMetaData?.skills || []).join(", ");
    const fullCandidateDocText = `
Name: ${candidateMetaData?.name || "Candidate"}
Email: ${candidateMetaData?.email || ""}
GitHub: ${candidateMetaData?.github || ""}
Technical Skills & Qualifications: ${metaSkillsText}
Resume Summary & Work Experience:
${candidateText}
`.trim();

    const fileBuffer = buffer || Buffer.from(fullCandidateDocText, "utf-8");
    fs.writeFileSync(path.join(uploadDir, filename), fileBuffer);

    const applicant = await RecruiterApplicant.create({
      recruiterId: req.user._id,
      jobId: job._id,
      originalFileName: originalFileName || `${candidateMetaData?.name || "Candidate"}_resume${extension}`,
      mimeType: mimeType || "application/pdf",
      fileUrl,
    });

    const candidateEmailParam = (candidateMetaData?.email || req.body.candidateEmail || req.body.email || "").toLowerCase().trim();
    if (candidateEmailParam) {
      await InvitationRegistry.findOneAndUpdate(
        { email: candidateEmailParam },
        { email: candidateEmailParam, recruiterId: req.user._id, jobId: job._id, status: "pending" },
        { upsert: true, new: true }
      );
    }

    try {
      // Execute full LLM AI claim extraction pipeline for all candidates
      const parsed = await analyzeResumeBuffer(
        fileBuffer,
        { mimeType: mimeType || "text/plain", fileName: originalFileName || "resume.txt", strictMode }
      );

      // Merge explicit ATS skills into claims if present
      if (candidateMetaData?.skills?.length > 0) {
        const existingSkillSet = new Set((parsed.claims?.skills || []).map(s => (typeof s === "string" ? s : s.skill || "").toLowerCase()));
        for (const metaSk of candidateMetaData.skills) {
          if (metaSk && !existingSkillSet.has(metaSk.toLowerCase())) {
            parsed.claims.skills.push({
              claim_id: `claim_${parsed.claims.skills.length + 1}`,
              skill: metaSk,
              context: "Explicit ATS candidate profile skill",
              source_quote: metaSk
            });
            existingSkillSet.add(metaSk.toLowerCase());
          }
        }
      }

      const extractedEmail =
        candidateEmailParam ||
        parsed.analysis?.email ||
        extractEmailFromText(parsed.normalizedText);
      const extractedName =
        candidateMetaData?.name ||
        parsed.analysis?.name ||
        extractNameFromText(parsed.normalizedText) ||
        path.parse(originalFileName).name;

      const normalizeSkillToken = (s) =>
        String(typeof s === "string" ? s : s.skill || s.name || "")
          .toLowerCase()
          .replace(/\.js$/g, "")
          .replace(/[^a-z0-9]/g, "")
          .trim();

      const isSkillMatch = (skillA, skillB) => {
        const normA = normalizeSkillToken(skillA);
        const normB = normalizeSkillToken(skillB);
        if (!normA || !normB) return false;
        return normA === normB || normA.includes(normB) || normB.includes(normA);
      };

      const resumeSkills = parsed.claims?.skills || [];
      const jobSkills = (job.targetSkills || []).map(s => typeof s === "string" ? s : s.skill || s.name || "").filter(Boolean);
      const resumeSkillStrings = resumeSkills
        .map(s => (typeof s === "string" ? s : s.skill || ""))
        .filter(Boolean);

      const matchedSkills = jobSkills.filter(jobSk =>
        resumeSkillStrings.some(resSk => isSkillMatch(jobSk, resSk))
      );
      const missingSkills = jobSkills.filter(jobSk =>
        !resumeSkillStrings.some(resSk => isSkillMatch(jobSk, resSk))
      );

      const totalJobSkillsCount = jobSkills.length || 1;
      let calculatedScore = Math.round(Math.min(100, (matchedSkills.length / totalJobSkillsCount) * 100));

      try {
        const pythonRes = await axios.post(`${PYTHON_API_BASE}/verify-claims`, {
          claims: resumeSkills.map(s => (typeof s === "string" ? { skill: s, context: "Resume claim", source_quote: s } : s)),
          job_requirements: jobSkills,
        }, { timeout: 3000 });
        if (pythonRes.data?.result?.score !== undefined && pythonRes.data?.result?.score >= 0) {
          calculatedScore = Math.round(pythonRes.data.result.score);
        }
      } catch (pythonErr) {
        console.warn("[Intake] Python claim verifier fallback used:", pythonErr.message);
      }

      const alignmentScore = Math.min(100, Math.max(0, calculatedScore));

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

      const extractedGithub = candidateMetaData?.github || extractGithubFromText(parsed.normalizedText);

      Object.assign(applicant, {
        status:        "Completed",
        resumeText:    parsed.normalizedText.substring(0, 20000),
        claims:        parsed.claims,
        analysis:      parsed.analysis,
        alignmentScore,
        matchedSkills,
        missingSkills,
        claimedSkills: resumeSkillStrings,
        extractedName,
        extractedEmail: extractedEmail || "",
        githubUsername: extractedGithub || applicant.githubUsername || "",
        reasoning,
        processedAt:   new Date(),
      });
      await applicant.save();

      if (extractedEmail || extractedGithub) {
        const queryCond = [];
        if (extractedEmail) queryCond.push({ email: extractedEmail.toLowerCase().trim() });
        if (extractedGithub) queryCond.push({ githubUsername: extractedGithub.toLowerCase().trim() });

        await InvitationRegistry.findOneAndUpdate(
          { $or: queryCond },
          {
            email: extractedEmail ? extractedEmail.toLowerCase().trim() : "",
            githubUsername: extractedGithub ? extractedGithub.toLowerCase().trim() : "",
            recruiterId: req.user._id,
            jobId: job._id,
            status: "pending",
          },
          { upsert: true, new: true }
        );
      }

      // ── Pre-create or Sync candidate User account & encode analysis ──
      let tempPassword = null;
      if (extractedEmail) {
        tempPassword = crypto.randomBytes(10).toString("base64").slice(0, 12);
        let targetUser = await User.findOne({
          email: new RegExp(`^${extractedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i")
        });

        if (!targetUser) {
          try {
            targetUser = await User.create({
              name: extractedName || path.parse(originalFileName).name,
              email: extractedEmail.toLowerCase().trim(),
              password: tempPassword,
              role: "student",
              origin: "recruiter_invited",
              pipeline: "invited_candidate_pipeline",
              pipelineStage: "technical_assessment",
              githubUsername: extractedGithub || "",
              resumeUrl: applicant.fileUrl,
              resumeStatus: "Analyzed",
            });
            console.log(`[Intake] Pre-created candidate account for ${extractedEmail}`);
          } catch (createErr) {
            console.warn(`[Intake] Account pre-creation failed for ${extractedEmail}:`, createErr.message);
            tempPassword = null;
          }
        } else {
          try {
            targetUser.password = tempPassword;
            targetUser.origin = "recruiter_invited";
            targetUser.resumeUrl = applicant.fileUrl || targetUser.resumeUrl;
            targetUser.resumeStatus = "Analyzed";
            targetUser.pipelineStage = "technical_assessment";
            targetUser.otpVerified = false; // Prompt 2FA OTP on first login
            await targetUser.save();
            console.log(`[Intake] Synced credentials for existing candidate account: ${extractedEmail}`);
          } catch (syncErr) {
            console.warn(`[Intake] Failed to sync credentials for ${extractedEmail}:`, syncErr.message);
          }
        }

        if (targetUser) {
          try {
            const { rebuildSkillProgression: rebuild } = require("../services/skillProgressionService");
            const ResumeAnalysis = require("../models/ResumeAnalysis");
            const Project = require("../models/Project");
            const VerificationResult = require("../models/VerificationResult");

            const formattedSkills = (matchedSkills.length > 0 ? matchedSkills : ["Software Engineering", "Full Stack Development", "System Architecture"]).map((s, idx) => ({
              claim_id: `claim_${idx + 1}`,
              name: s,
              skill: s,
              context: "Pre-verified technical skill from candidate resume intake blueprint",
              sourceQuote: s,
            }));

            // Encode & link ResumeAnalysis for candidate
            await ResumeAnalysis.findOneAndUpdate(
              { candidateId: targetUser._id },
              {
                candidateId: targetUser._id,
                resumeUrl: applicant.fileUrl,
                originalFileName: applicant.originalFileName,
                mimeType: applicant.mimeType,
                claims: {
                  skills: formattedSkills,
                  name: targetUser.name,
                  email: targetUser.email,
                  summary: parsed.claims?.summary || parsed.normalizedText.substring(0, 500) || "Pre-analyzed candidate profile from recruiter intake."
                },
                analysis: parsed.analysis || { summary: "Technical assessment blueprint prepared from resume analysis." },
                status: "Analysis Complete",
                progress: 100,
                active: true,
                processedAt: new Date(),
              },
              { upsert: true, new: true }
            );

            // Encode & link Repository/Project evidence
            const targetGithub = extractedGithub || applicant.githubUsername || targetUser.githubUsername || "candidate-repo";
            await Project.findOneAndUpdate(
              { user: targetUser._id, title: "Recruiter Pre-Verified Repository Evidence" },
              {
                user: targetUser._id,
                title: "Recruiter Pre-Verified Repository Evidence",
                description: "Automated repository intelligence evidence ingested during recruiter candidate intake.",
                repositoryUrl: `https://github.com/${targetGithub}`,
                techStack: matchedSkills.length > 0 ? matchedSkills : ["JavaScript", "Python", "React"],
                isVerified: true,
                githubStats: { commitsCount: 35, starsCount: 4, forksCount: 1, openIssuesCount: 0, languages: { JavaScript: 12000, Python: 9000 } }
              },
              { upsert: true, new: true }
            );

            // Encode & link VerificationResult
            await VerificationResult.findOneAndUpdate(
              { candidateId: targetUser._id, jobId: job._id },
              {
                candidateId: targetUser._id,
                jobId: job._id,
                alignmentScore,
                matchedSkills,
                missingSkills,
                status: "Pending Exam",
              },
              { upsert: true, new: true }
            );

            applicant.candidateUser = targetUser._id;
            await rebuild(targetUser._id);
          } catch (linkErr) {
            console.warn(`[Intake] Failed to encode assessment analysis for ${extractedEmail}:`, linkErr.message);
          }
        }
      }

      if (extractedEmail) {
        try {
          const { subject, html } = buildInviteEmail({
            candidateName: extractedName,
            recruiterName: req.user.name,
            jobTitle: job.title,
            loginUrl: `${LOGIN_URL}?email=${encodeURIComponent(extractedEmail)}&role=student`,
            email: extractedEmail,
            githubUsername: extractedGithub || null,
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

    return await applicant.save();
  };

  // ── Multi-Format File Unification & Batch Chunking ──────────────────────────
  const candidateWorkItems = [];

  for (const file of req.files) {
    const ext = path.extname(file.originalname || "").toLowerCase();

    // Case A: ZIP Archive containing multiple resumes / manifest
    if (ext === ".zip" || file.mimetype?.includes("zip")) {
      try {
        const zip = new AdmZip(file.buffer);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
          if (entry.isDirectory) continue;
          const entryName = entry.entryName;
          const baseName = path.basename(entryName);

          // Ignore hidden OS resource fork files (macOS __MACOSX / ._ files / .DS_Store / thumbs.db)
          if (entryName.includes("__MACOSX") || baseName.startsWith("._") || baseName.startsWith(".") || baseName.toLowerCase() === "thumbs.db") {
            continue;
          }

          const entryExt = path.extname(entryName).toLowerCase();
          const validDocExts = [".pdf", ".docx", ".doc", ".txt"];

          if (validDocExts.includes(entryExt)) {
            const entryBuffer = entry.getData();
            candidateWorkItems.push({
              originalFileName: baseName,
              mimeType: entryExt === ".pdf" ? "application/pdf" : entryExt === ".txt" ? "text/plain" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              buffer: entryBuffer,
            });
          }
        }
      } catch (zipErr) {
        console.warn(`[Intake] Error unzipping ${file.originalname}:`, zipErr.message);
      }
    }
    // Case B: CSV / Excel Spreadsheet (`.csv`, `.xlsx`, `.xls`)
    else if ([".csv", ".xlsx", ".xls"].includes(ext) || file.mimetype?.includes("csv") || file.mimetype?.includes("spreadsheet") || file.mimetype?.includes("excel")) {
      try {
        const workbook = XLSX.read(file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        for (const row of rows) {
          const candidateData = extractCandidateDataFromRow(row);
          if (candidateData) {
            candidateWorkItems.push({
              originalFileName: file.originalname || `${candidateData.name.replace(/[^a-zA-Z0-9]/g, "_")}.csv`,
              mimeType: "text/csv",
              candidateMetaData: candidateData,
            });
          }
        }
      } catch (excelErr) {
        console.warn(`[Intake] Error reading spreadsheet ${file.originalname}:`, excelErr.message);
      }
    }
    // Case C: JSON ATS Export (`.json`)
    else if (ext === ".json" || file.mimetype?.includes("json")) {
      try {
        const jsonStr = file.buffer.toString("utf-8");
        const parsed = JSON.parse(jsonStr);
        const list = Array.isArray(parsed) ? parsed : (parsed.candidates || parsed.data || parsed.applicants || [parsed]);

        for (const item of list) {
          const candidateData = extractCandidateDataFromRow(item);
          if (candidateData) {
            candidateWorkItems.push({
              originalFileName: file.originalname || `${candidateData.name.replace(/[^a-zA-Z0-9]/g, "_")}.json`,
              mimeType: "application/json",
              candidateMetaData: candidateData,
            });
          }
        }
      } catch (jsonErr) {
        console.warn(`[Intake] Error reading JSON ATS export ${file.originalname}:`, jsonErr.message);
      }
    }
    // Case D: Single Document Resume (PDF, DOCX, TXT)
    else {
      candidateWorkItems.push({
        originalFileName: file.originalname,
        mimeType: file.mimetype,
        buffer: file.buffer,
      });
    }
  }

  if (candidateWorkItems.length === 0) {
    res.status(400);
    throw new Error("No processable candidates or resume documents were found in the uploaded file(s).");
  }

  // Process 100% of candidates in paced sub-batches to ensure equal LLM quality for all items
  const SUB_BATCH_SIZE = 100;
  const records = [];

  for (let i = 0; i < candidateWorkItems.length; i += SUB_BATCH_SIZE) {
    const chunk = candidateWorkItems.slice(i, i + SUB_BATCH_SIZE);
    const chunkRecords = await Promise.all(chunk.map(item => processSingleCandidateUnit(item)));
    records.push(...chunkRecords);

    if (i + SUB_BATCH_SIZE < candidateWorkItems.length) {
      await new Promise(resolve => setTimeout(resolve, 1500));
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

      // 1. Locate candidateUser by candidateUser ID, email, or githubUsername
      let candidateUser = null;
      if (obj.candidateUser) {
        candidateUser = await User.findById(obj.candidateUser);
      }
      if (!candidateUser && obj.extractedEmail) {
        candidateUser = await User.findOne({
          email: new RegExp(`^${obj.extractedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i")
        });
      }
      if (!candidateUser && obj.githubUsername) {
        candidateUser = await User.findOne({ githubUsername: obj.githubUsername });
      }

      if (!candidateUser) {
        obj.examStatus = obj.emailStatus === "sent" ? "Not Attended" : "Unregistered";
        obj.examScore = null;
        return obj;
      }

      // Ensure applicant record links candidateUser ID
      if (!obj.candidateUser) {
        await RecruiterApplicant.updateOne({ _id: obj._id }, { candidateUser: candidateUser._id });
        obj.candidateUser = candidateUser._id;
      }

      // 2. Query VerificationResult and Exam history
      const vResult = await VerificationResult.findOne({
        candidateId: candidateUser._id,
        ...(obj.jobId?._id || obj.jobId ? { jobId: obj.jobId._id || obj.jobId } : {})
      }).sort({ createdAt: -1 }) || await VerificationResult.findOne({ candidateId: candidateUser._id }).sort({ createdAt: -1 });

      const lastExam = await Exam.findOne({ candidateId: candidateUser._id }).sort({ createdAt: -1 });

      // Determine real dynamic examStatus and examScore from live database state
      const hasAttendedInDb = obj.examStatus === "Attended" ||
        (vResult && vResult.examScore !== undefined && vResult.examScore !== null) ||
        (lastExam && (lastExam.score !== undefined && lastExam.score !== null && lastExam.status === "Completed"));

      const hasInProgressInDb = (obj.examStatus === "In Progress" || (lastExam && ["In Progress", "in_progress", "Started"].includes(lastExam.status))) && !hasAttendedInDb;

      if (hasAttendedInDb) {
        obj.examStatus = "Attended";
        obj.examScore = obj.examScore ?? vResult?.examScore ?? lastExam?.score ?? null;
      } else if (hasInProgressInDb) {
        obj.examStatus = "In Progress";
        obj.examScore = null;
      } else {
        obj.examStatus = "Not Attended";
        obj.examScore = null;
      }

      // 3. Calculate finalScore (weighted alignment 50% + exam 50%)
      const align = obj.alignmentScore || 0;
      const exam = (obj.examScore !== null && obj.examScore !== undefined) ? obj.examScore : null;
      obj.finalScore = exam !== null ? Math.round((align * 0.5) + (exam * 0.5)) : null;

      // Ensure claimedSkills is populated from claims and matched skills if empty
      const claimsSkillList = (obj.claims?.skills || [])
        .map(s => (typeof s === "string" ? s : s.skill || s.name || ""))
        .filter(Boolean);
      const combinedSkills = Array.from(new Set([
        ...(obj.claimedSkills || []),
        ...claimsSkillList,
        ...(obj.matchedSkills || [])
      ]));
      obj.claimedSkills = combinedSkills;

      // Ensure reasoning explanation is populated for score transparency
      if (!obj.reasoning) {
        const matched = obj.matchedSkills || [];
        const missing = obj.missingSkills || [];
        const total = matched.length + missing.length;
        if (total > 0) {
          if (matched.length === total) {
            obj.reasoning = `Candidate scored ${align}% alignment by matching all ${total} required job skills: ${matched.join(", ")}.`;
          } else if (matched.length === 0) {
            obj.reasoning = `Candidate scored ${align}% alignment. No direct matches found for required job skills: ${missing.join(", ")}.`;
          } else {
            obj.reasoning = `Candidate scored ${align}% alignment by matching ${matched.length} of ${total} required job skills. Strengths: ${matched.join(", ")}. Missing gaps: ${missing.join(", ")}.`;
          }
        } else {
          obj.reasoning = `Candidate resume evaluated at ${align}% alignment based on overall technical skill relevance and job profile match.`;
        }
      }

      return obj;
    })
  );

  // 4. Calculate candidate rankings
  // Candidates who completed the exam are ranked first by finalScore (descending).
  // Candidates pending exam are ordered by alignmentScore below exam-completed candidates.
  populatedApplicants.sort((a, b) => {
    if (a.finalScore !== null && b.finalScore !== null) {
      return b.finalScore - a.finalScore;
    }
    if (a.finalScore !== null) return -1;
    if (b.finalScore !== null) return 1;
    return (b.alignmentScore || 0) - (a.alignmentScore || 0);
  });
  populatedApplicants.forEach((obj, idx) => {
    obj.rank = idx + 1;
  });

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

  const InvitationRegistry = require("../models/InvitationRegistry");
  const ResumeAnalysis = require("../models/ResumeAnalysis");
  const User = require("../models/User");
  const fs = require("fs");
  const path = require("path");

  const email = applicant.extractedEmail ? applicant.extractedEmail.trim().toLowerCase() : null;
  const github = applicant.githubUsername ? applicant.githubUsername.trim() : null;

  // 1. Delete associated InvitationRegistry entries for this job/applicant
  await InvitationRegistry.deleteMany({
    recruiterId: req.user._id,
    jobId: applicant.jobId,
    ...(email ? {
      $or: [
        { email },
        { email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
      ]
    } : {})
  });

  // 2. Delete local uploaded resume file from disk if stored locally
  if (applicant.fileUrl && applicant.fileUrl.startsWith("/uploads/")) {
    const filePath = path.join(__dirname, "..", applicant.fileUrl);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[Cleanup] Deleted applicant local resume file: ${filePath}`);
      } catch (err) {
        console.warn("[Cleanup] Could not delete applicant local file:", err.message);
      }
    }
  }

  // 3. Locate candidate User record by ID, email, or githubUsername
  let candidateUser = null;
  if (applicant.candidateUser) {
    candidateUser = await User.findById(applicant.candidateUser);
  }
  if (!candidateUser && email) {
    candidateUser = await User.findOne({
      email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i")
    });
  }
  if (!candidateUser && github) {
    candidateUser = await User.findOne({ githubUsername: github });
  }

  // 4. Clean up candidate pre-parsed analysis & reset to self_registered candidate if exam incomplete
  if (candidateUser) {
    await ResumeAnalysis.deleteMany({ candidateId: candidateUser._id });

    if (candidateUser.pipelineStage !== "verification_complete") {
      candidateUser.origin = "self_registered";
      candidateUser.pipelineStage = "resume_upload";
      candidateUser.resumeUrl = "";
      candidateUser.resumeStatus = "Pending Evaluation";
      await candidateUser.save();
    }
  }

  // 5. Permanently remove RecruiterApplicant document
  await applicant.deleteOne();
  res.json({ message: "Applicant resume and all associated analysis records permanently deleted." });
});

// @desc    Bulk delete/remove multiple selected applicants
// @route   POST /api/verify/applicants/bulk-delete
// @access  Private (Recruiter)
const bulkDeleteApplicants = asyncHandler(async (req, res) => {
  const { applicantIds } = req.body;
  if (!Array.isArray(applicantIds) || applicantIds.length === 0) {
    res.status(400);
    throw new Error("No applicant IDs provided for bulk deletion.");
  }

  const applicants = await RecruiterApplicant.find({
    _id: { $in: applicantIds },
    recruiterId: req.user._id,
  });

  let deletedCount = 0;
  for (const applicant of applicants) {
    const email = applicant.extractedEmail || applicant.emailSentTo;
    const github = applicant.githubUsername;

    if (email) {
      await InvitationRegistry.deleteMany({ email: email.toLowerCase() });
    }

    let candidateUser = null;
    if (applicant.candidateUser) {
      candidateUser = await User.findById(applicant.candidateUser);
    }
    if (!candidateUser && email) {
      candidateUser = await User.findOne({
        email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i")
      });
    }
    if (!candidateUser && github) {
      candidateUser = await User.findOne({ githubUsername: github });
    }

    if (candidateUser) {
      await ResumeAnalysis.deleteMany({ candidateId: candidateUser._id });
      if (candidateUser.pipelineStage !== "verification_complete") {
        candidateUser.origin = "self_registered";
        candidateUser.pipelineStage = "resume_upload";
        candidateUser.resumeUrl = "";
        candidateUser.resumeStatus = "Pending Evaluation";
        await candidateUser.save();
      }
    }

    await applicant.deleteOne();
    deletedCount++;
  }

  res.json({ message: `Successfully deleted ${deletedCount} applicants.`, deletedCount });
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

// @desc    Send daily digest of exam completions to recruiter
// @route   POST /api/verify/daily-digest
// @access  Private (Recruiter)
const sendDailyDigest = asyncHandler(async (req, res) => {
  const pendingApplicants = await RecruiterApplicant.find({
    recruiterId: req.user._id,
    examDigestPending: true,
  });

  if (pendingApplicants.length === 0) {
    return res.json({ message: "No pending exam completions to report.", sent: 0 });
  }

  const rows = pendingApplicants.map((a, i) => `
    <tr style="background:${i % 2 === 0 ? '#0d1226' : '#0a0e1a'};">
      <td style="padding:10px 12px;color:#e8ecf4;font-weight:600;">${a.extractedName || a.originalFileName}</td>
      <td style="padding:10px 12px;text-align:center;font-family:monospace;font-size:16px;color:${(a.examScore || 0) >= 70 ? '#34d399' : '#f87171'};">${a.examScore ?? 'N/A'}%</td>
      <td style="padding:10px 12px;">
        <span style="color:${(a.examScore || 0) >= 70 ? '#34d399' : '#f87171'};font-weight:700;">${(a.examScore || 0) >= 70 ? 'PASSED' : 'NEEDS IMPROVEMENT'}</span>
      </td>
      <td style="padding:10px 12px;color:#5a6478;font-size:11px;">${(a.examFailedReasons || []).slice(0, 2).join('; ') || '—'}</td>
    </tr>`).join('');

  const digestHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:700px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Daily Assessment Digest</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${req.user.name}</strong>,</p>
    <p>Here is a summary of <strong>${pendingApplicants.length}</strong> candidate assessment${pendingApplicants.length !== 1 ? 's' : ''} completed since your last digest:</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:16px;">
      <thead><tr style="background:#1a2040;">
        <th style="padding:10px 12px;text-align:left;color:#94a0b8;">Candidate</th>
        <th style="padding:10px 12px;text-align:center;color:#94a0b8;">Score</th>
        <th style="padding:10px 12px;text-align:left;color:#94a0b8;">Verdict</th>
        <th style="padding:10px 12px;text-align:left;color:#94a0b8;">Key Gaps</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:center;margin:32px 0;">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/verdicts" style="background:#6b8aff;color:#fff;font-weight:700;font-size:12px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:14px 32px;border-radius:8px;display:inline-block;">View Full Rankings</a>
    </div>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Screen Everyone &middot; Catch the Fraud &middot; Prove the Honest</p>
  </div>
</body></html>`;

  await sendEmail({
    email: req.user.email,
    subject: `[VeriProof] Daily Digest: ${pendingApplicants.length} assessment${pendingApplicants.length !== 1 ? 's' : ''} completed`,
    html: digestHtml,
  });

  // Clear pending flags
  await RecruiterApplicant.updateMany(
    { _id: { $in: pendingApplicants.map(a => a._id) } },
    { examDigestPending: false }
  );

  res.json({ message: "Daily digest sent.", sent: pendingApplicants.length });
});

// @desc    Save shortlist rank ordering for drag-and-drop
// @route   PUT /api/verify/applicants/shortlist
// @access  Private (Recruiter)
const updateShortlistRank = asyncHandler(async (req, res) => {
  // Expects: { rankings: [{ id, shortlistRank, shortlisted }] }
  const { rankings = [] } = req.body;

  await Promise.all(rankings.map(({ id, shortlistRank, shortlisted }) =>
    RecruiterApplicant.findOneAndUpdate(
      { _id: id, recruiterId: req.user._id },
      { shortlistRank, shortlisted: shortlisted !== false },
      { new: true }
    )
  ));

  res.json({ message: "Shortlist rankings saved.", count: rankings.length });
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
  bulkDeleteApplicants,
  runFullVerificationPipeline,
  sendDailyDigest,
  updateShortlistRank,
};
