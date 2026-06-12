const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const {
  getSkillTree,
  getCandidateSkillTree,
  recordSkillEvent,
  getSkillSummary,
} = require("../controllers/skillTreeController");

router.get("/summary", protect, getSkillSummary);
router.get("/candidate/:candidateId", protect, getCandidateSkillTree);
router.post("/event", protect, recordSkillEvent);
router.get("/", protect, getSkillTree);

module.exports = router;
