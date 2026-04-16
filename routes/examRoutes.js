const express = require("express");
const router = express.Router();
const { startExam, submitExam } = require("../controllers/examController");
const { protect } = require("../middleware/authMiddleware");

// GET /api/exams/start
router.get("/start", protect, startExam);
router.post("/submit", protect, submitExam);

module.exports = router;
