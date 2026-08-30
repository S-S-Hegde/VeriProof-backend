const express = require("express");
const router = express.Router();
const {
  startExam,
  submitExam,
  getExamHistory,
  analyzeProctorSnapshot,
  recordProctorViolation,
  recordViolationSnapshot,
  getProjectDefenseQuestions,
  evaluateDefenseSubmission,
} = require("../controllers/examController");
const { protect } = require("../middleware/authMiddleware");
const {
  validateExamSubmission,
  examActionRateLimit,
} = require("../middleware/examSecurityFirewall");

// Stage 1 & Stage 2 Examination Endpoints
router.get("/start", protect, examActionRateLimit, startExam);
router.post("/submit", protect, examActionRateLimit, validateExamSubmission, submitExam);
router.get("/history", protect, getExamHistory);

// Stage 2: Adaptive Project Defense Endpoints
router.post("/project-defense", protect, examActionRateLimit, getProjectDefenseQuestions);
router.get("/project-defense", protect, examActionRateLimit, getProjectDefenseQuestions);
router.post("/project-defense/evaluate", protect, examActionRateLimit, evaluateDefenseSubmission);

// Anti-Cheat & Proctoring Telemetry
router.post("/proctor-snapshot", protect, analyzeProctorSnapshot);
router.post("/record-violation", protect, recordProctorViolation);
router.post("/record-violation-snapshot", recordViolationSnapshot);

module.exports = router;
