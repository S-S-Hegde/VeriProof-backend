const asyncHandler = require("express-async-handler");
const Job = require("../models/Job");
const VerificationResult = require("../models/VerificationResult");
const Exam = require("../models/Exam");
const User = require("../models/User");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const RecruiterApplicant = require("../models/RecruiterApplicant");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { analyzeResumeBuffer, extractTextFromBuffer, normalizeText } = require("../services/resumeIntelligenceService");
const { flatSkillCatalog } = require("../data/skillCatalog");
const { rebuildSkillProgression } = require("../services/skillProgressionService");
const { scoreClaimsAgainstJob, selectAdaptiveQuestions } = require("../services/claimVerificationService");

// @desc    Parse Resume against Job description
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

  const analysis = await ResumeAnalysis.findOne({ candidateId, active: true, status: "Analysis Complete" });
  if (!analysis) {
    res.status(409);
    throw new Error("The candidate's latest resume must finish analysis before screening.");
  }
  const scoring = scoreClaimsAgainstJob(analysis.claims, job);
  const status = "Pending Exam";

  const result = await VerificationResult.findOneAndUpdate(
    { candidateId, jobId },
    {
      $set: {
        candidateId,
        jobId,
        resumeText: analysis.truncatedText,
        sourceAnalysisId: analysis._id,
        ...scoring,
        status,
      },
      $unset: { examScore: 1, examId: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.status(201).json(result);
});

// @desc    Get Exam for Candidate
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

  let exam = verificationResult.examId ? await Exam.findById(verificationResult.examId) : null;
  if (!exam) {
    const job = await Job.findById(req.params.jobId);
    const skills = [...new Set([...(verificationResult.matchedSkills || []), ...(job?.targetSkills || [])])];
    const bankQuestions = await selectAdaptiveQuestions(skills, 10);
    if (!bankQuestions.length) {
      res.status(409);
      throw new Error("No exam questions are available. Seed the question bank before starting verification.");
    }
    exam = await Exam.create({
      verificationResultId: verificationResult._id,
      sourceAnalysisId: verificationResult.sourceAnalysisId,
      topic: job?.title || "Claim Verification",
      skills,
      passingScore: 70,
      questions: bankQuestions.map((question) => ({
        questionText: question.text,
        options: question.options,
        correctOption: question.correctIndex,
      })),
    });
    verificationResult.examId = exam._id;
    await verificationResult.save();
  }

  // Hide correctOptions from candidate
  const candidateExam = {
    _id: exam._id,
    topic: exam.topic,
    passingScore: exam.passingScore,
    questions: exam.questions.map(q => ({
      _id: q._id,
      questionText: q.questionText,
      options: q.options
    }))
  };

  res.json(candidateExam);
});

// @desc    Submit Exam Answers
// @route   POST /api/verify/exam/:resultId
// @access  Private
const submitExam = asyncHandler(async (req, res) => {
  const { examId, answers } = req.body; // answers: array of integers (selected options)
  
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
  // Fetch jobs owned by this recruiter
  const jobs = await Job.find({ recruiterId: req.user._id });
  const jobIds = jobs.map(j => j._id);

  // Fetch results mapping to these jobs
  const results = await VerificationResult.find({ jobId: { $in: jobIds } })
    .populate("candidateId", "name email profileImage")
    .populate("jobId", "title");

  res.json(results);
});

// @desc    Get Candidate Verification Dashboard Data
// @route   GET /api/verify/my-results
// @access  Private (Student)
const getCandidateResults = asyncHandler(async (req, res) => {
  const results = await VerificationResult.find({ candidateId: req.user._id })
    .populate("jobId", "title");
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
    targetSkills
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
  const rawText = await extractTextFromBuffer(req.file.buffer, req.file.mimetype, req.file.originalname);
  const description = normalizeText(rawText);
  if (!description) {
    res.status(400);
    throw new Error("No readable job-description text was found.");
  }
  const lower = description.toLowerCase();
  const targetSkills = flatSkillCatalog
    .filter((skill) => skill.triggers.some((trigger) => lower.includes(trigger.toLowerCase())))
    .map((skill) => skill.name);
  const title = String(req.body.title || path.parse(req.file.originalname).name).trim();
  const job = await Job.create({ recruiterId: req.user._id, title, description, targetSkills });
  res.status(201).json(job);
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
  const records = await Promise.all(req.files.map(async (file) => {
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
      const scoring = scoreClaimsAgainstJob(parsed.claims, job);
      Object.assign(applicant, {
        status: "Completed",
        resumeText: parsed.normalizedText.substring(0, 20000),
        claims: parsed.claims,
        analysis: parsed.analysis,
        ...scoring,
        processedAt: new Date(),
      });
    } catch (error) {
      applicant.status = "Failed";
      applicant.error = error.message;
      applicant.processedAt = new Date();
    }
    return applicant.save();
  }));
  res.status(201).json(records);
});

const getApplicantResumes = asyncHandler(async (req, res) => {
  const filter = { recruiterId: req.user._id };
  if (req.query.jobId) filter.jobId = req.query.jobId;
  const applicants = await RecruiterApplicant.find(filter).populate("jobId", "title").sort({ createdAt: -1 });
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
