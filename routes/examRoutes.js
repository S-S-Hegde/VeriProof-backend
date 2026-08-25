const express = require("express");
const router = express.Router();
const {
  startExam,
  submitExam,
  getExamHistory,
  analyzeProctorSnapshot,
  recordProctorViolation,
  recordViolationSnapshot,
} = require("../controllers/examController");
const { protect } = require("../middleware/authMiddleware");
const {
  validateExamSubmission,
  examActionRateLimit,
} = require("../middleware/examSecurityFirewall");

// GET /api/exams/start
router.get("/start", protect, examActionRateLimit, startExam);
router.post("/submit", protect, examActionRateLimit, validateExamSubmission, submitExam);
router.get("/history", protect, getExamHistory);
router.post("/proctor-snapshot", protect, analyzeProctorSnapshot);
router.post("/record-violation", protect, recordProctorViolation);
router.post("/record-violation-snapshot", recordViolationSnapshot);

module.exports = router;

