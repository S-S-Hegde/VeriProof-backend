const express = require("express");
const router = express.Router();
const {
  parseResume,
  getExamForJob,
  submitExam,
  getRecruiterResults,
  getCandidateResults,
  createJobRole,
  getMyJobs
} = require("../controllers/verifyController");
const { protect, recruiter } = require("../middleware/authMiddleware");

// Recruiter endpoints
router.post("/parse", protect, recruiter, parseResume);
router.get("/results", protect, recruiter, getRecruiterResults);
router.post("/job", protect, recruiter, createJobRole);
router.get("/my-jobs", protect, recruiter, getMyJobs);

// Candidate endpoints
router.get("/my-results", protect, getCandidateResults);
router.get("/exam/:jobId", protect, getExamForJob);
router.post("/exam/:resultId", protect, submitExam);

module.exports = router;
