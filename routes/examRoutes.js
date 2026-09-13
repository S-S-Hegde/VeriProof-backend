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
  submitCalibration,
  startPart2,
  purgatoryTimeout,
  getRankings,
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

// Adaptive CAT Engine Endpoints
router.post("/submit-calibration", protect, examActionRateLimit, submitCalibration);
router.post("/start-part2", protect, examActionRateLimit, startPart2);
router.post("/purgatory-timeout", protect, examActionRateLimit, purgatoryTimeout);

// Recruiter Endpoints
router.get("/rankings", protect, getRankings);

// Stage 2: Adaptive Project Defense Endpoints
router.post("/project-defense", protect, examActionRateLimit, getProjectDefenseQuestions);
router.get("/project-defense", protect, examActionRateLimit, getProjectDefenseQuestions);
router.post("/project-defense/evaluate", protect, examActionRateLimit, evaluateDefenseSubmission);

// Anti-Cheat & Proctoring Telemetry
router.post("/proctor-snapshot", protect, analyzeProctorSnapshot);
router.post("/record-violation", protect, recordProctorViolation);
router.post("/record-violation-snapshot", recordViolationSnapshot);

module.exports = router;
