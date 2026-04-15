const express = require("express");
const router = express.Router();
const { startExam } = require("../controllers/examController");
const { protect } = require("../middleware/authMiddleware");

// GET /api/exams/start
router.get("/start", protect, startExam);

module.exports = router;
