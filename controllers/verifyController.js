const asyncHandler = require("express-async-handler");
const Job = require("../models/Job");
const VerificationResult = require("../models/VerificationResult");
const Exam = require("../models/Exam");
const User = require("../models/User");

// @desc    Parse Resume against Job description
// @route   POST /api/verify/parse
// @access  Private (Recruiter)
const parseResume = asyncHandler(async (req, res) => {
  const { resumeText, candidateId, jobId } = req.body;

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

  // Mock parsing algorithm: Intersect targetSkills with resumeText keywords
  const textLower = resumeText.toLowerCase();
  let matchedSkills = 0;
  
  job.targetSkills.forEach((skill) => {
    if (textLower.includes(skill.toLowerCase())) {
      matchedSkills++;
    }
  });

  const alignmentScore = job.targetSkills.length > 0
    ? Math.round((matchedSkills / job.targetSkills.length) * 100)
    : 100;

  // Verification Workflow: score < 75% -> triggers exam
  const status = alignmentScore < 75 ? "Pending Exam" : "Verified";

  if (status === "Pending Exam") {
    // Mock Automated Email
    console.log(`[Verification Engine] EMAIL SENT to ${candidate.email}: Alignment Score ${alignmentScore}%. Please complete the Verification Exam to proceed.`);
  }

  const result = await VerificationResult.findOneAndUpdate(
    { candidateId, jobId },
    {
      candidateId,
      jobId,
      resumeText,
      alignmentScore,
      status,
      examScore: undefined,
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

  // Mock finding an exam related to the job topic. 
  // In reality, we'd relate Exam to Job directly or via tags. We'll return a generic mock exam here.
  let exam = await Exam.findOne();
  
  if (!exam) {
    // Seed a mock exam if none exists
    exam = await Exam.create({
      topic: "General Software Engineering",
      passingScore: 70,
      questions: [
        {
          questionText: "What is the primary purpose of a reverse proxy?",
          options: ["Database scaling", "Load balancing and security", "Frontend rendering", "Code compilation"],
          correctOption: 1
        },
        {
          questionText: "Which HTTP method is idempotent?",
          options: ["POST", "PUT", "PATCH", "None"],
          correctOption: 1
        }
      ]
    });
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

module.exports = {
  parseResume,
  getExamForJob,
  submitExam,
  getRecruiterResults,
  getCandidateResults,
  createJobRole,
  getMyJobs
};
