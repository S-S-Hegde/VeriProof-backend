const asyncHandler = require("express-async-handler");
const axios = require("axios"); // <-- New import for making requests to Python
const Job = require("../models/Job");
const VerificationResult = require("../models/VerificationResult");
const Exam = require("../models/Exam");
const User = require("../models/User");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const RecruiterApplicant = require("../models/RecruiterApplicant");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  analyzeResumeBuffer,
  extractTextFromBuffer,
  normalizeText,
} = require("../services/resumeIntelligenceService");
const { flatSkillCatalog } = require("../data/skillCatalog");
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

  // --- PROXY TO PYTHON MODULE 1 (Claim Verifier) ---
  let alignmentScore = 0;
  let verifiableMatched = 0;
  try {
    const pythonRes = await axios.post(`${PYTHON_API_BASE}/verify-claims`, {
      claims: analysis.claims.skills || [],
      job_requirements: job.targetSkills || [],
    });
    alignmentScore = pythonRes.data.result.score || 0;
    verifiableMatched = pythonRes.data.result.verifiable_claims_matched || 0;
  } catch (error) {
    console.error("[Python Proxy] Claim Verification Failed:", error.message);
    alignmentScore = 0; // Fallback score on error
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
        matchedSkills: [], // Deprecated in favor of numerical verifiableMatched count
        missingSkills: [],
        status,
      },
      $unset: { examScore: 1, examId: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Attach metadata for the frontend
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

    // --- PROXY TO PYTHON MODULE 3 (Assessment Generator) ---
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
        // Find the index of the correct answer from the array of options
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

  // Hide correctOptions from candidate
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
  const job = await Job.create({
    recruiterId: req.user._id,
    title,
    description,
    targetSkills,
  });
  res.status(201).json(job);
});

const getMyJobs = asyncHandler(async (req, res) => {
  const jobs = await Job.find({ recruiterId: req.user._id });
  res.json(jobs);
});

const createJobFromFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("A PDF, DOCX, or TXT job description is required.");
  }
  const rawText = await extractTextFromBuffer(
    req.file.buffer,
    req.file.mimetype,
    req.file.originalname,
  );
  const description = normalizeText(rawText);
  if (!description) {
    res.status(400);
    throw new Error("No readable job-description text was found.");
  }
  const lower = description.toLowerCase();
  const targetSkills = flatSkillCatalog
    .filter((skill) =>
      skill.triggers.some((trigger) => lower.includes(trigger.toLowerCase())),
    )
    .map((skill) => skill.name);
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
});

const uploadApplicantResumes = asyncHandler(async (req, res) => {
  const job = await Job.findOne({
    _id: req.body.jobId,
    recruiterId: req.user._id,
  });
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
  const records = await Promise.all(
    req.files.map(async (file) => {
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
        const parsed = await analyzeResumeBuffer(file.buffer, {
          mimeType: file.mimetype,
          fileName: file.originalname,
          userProfile: { name: path.parse(file.originalname).name },
        });

        // --- PROXY TO PYTHON MODULE 1 (Claim Verifier) ---
        let alignmentScore = 0;
        try {
          const pythonRes = await axios.post(
            `${PYTHON_API_BASE}/verify-claims`,
            {
              claims: parsed.claims.skills || [],
              job_requirements: job.targetSkills || [],
            },
          );
          alignmentScore = pythonRes.data.result.score || 0;
        } catch (error) {
          console.error("[Python Proxy] Bulk Claim Verification Failed");
        }

        Object.assign(applicant, {
          status: "Completed",
          resumeText: parsed.normalizedText.substring(0, 20000),
          claims: parsed.claims,
          analysis: parsed.analysis,
          alignmentScore: alignmentScore,
          matchedSkills: [],
          missingSkills: [],
          processedAt: new Date(),
        });
      } catch (error) {
        applicant.status = "Failed";
        applicant.error = error.message;
        applicant.processedAt = new Date();
      }
      return applicant.save();
    }),
  );
  res.status(201).json(records);
});

const getApplicantResumes = asyncHandler(async (req, res) => {
  const filter = { recruiterId: req.user._id };
  if (req.query.jobId) filter.jobId = req.query.jobId;
  const applicants = await RecruiterApplicant.find(filter)
    .populate("jobId", "title")
    .sort({ createdAt: -1 });
  res.json(applicants);
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
};
