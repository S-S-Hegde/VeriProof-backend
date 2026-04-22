const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { generateSkillTree, getSkillTree } = require("../controllers/skillTreeController");

// POST /api/skill-tree/generate — Generate or regenerate skill tree via LLM
router.post("/generate", protect, generateSkillTree);

// GET /api/skill-tree — Retrieve the current user's skill tree
router.get("/", protect, getSkillTree);

module.exports = router;
