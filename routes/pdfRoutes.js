const express = require("express");
const router  = express.Router();
const { generateResumePDF } = require("../controllers/pdfController");
const { protect } = require("../middleware/authMiddleware");

// POST /api/resume/generate  — generate and stream a PDF resume
router.post("/generate", protect, generateResumePDF);

module.exports = router;
