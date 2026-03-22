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
const { protect, recruiterOnly } = require("../middleware/authMiddleware");

// Recruiter endpoints
router.post("/parse", protect, recruiterOnly, parseResume);
router.get("/results", protect, recruiterOnly, getRecruiterResults);
router.post("/job", protect, recruiterOnly, createJobRole);
router.get("/my-jobs", protect, recruiterOnly, getMyJobs);

// Candidate endpoints
router.get("/my-results", protect, getCandidateResults);
router.get("/exam/:jobId", protect, getExamForJob);
router.post("/exam/:resultId", protect, submitExam);

module.exports = router;
