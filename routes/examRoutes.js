const express = require("express");
const router = express.Router();
const {
  startExam,
  submitExam,
  getExamHistory,
  analyzeProctorSnapshot,
} = require("../controllers/examController");
const { protect } = require("../middleware/authMiddleware");

// GET /api/exams/start
router.get("/start", protect, startExam);
router.post("/submit", protect, submitExam);
router.get("/history", protect, getExamHistory);
router.post("/proctor-snapshot", protect, analyzeProctorSnapshot);

module.exports = router;
