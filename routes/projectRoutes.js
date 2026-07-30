const express = require("express");
const router = express.Router();
const {
  createProject,
  getProjects,
  getMyProjects,
  getProjectById,
  syncProject,
  getMyAnalytics,
} = require("../controllers/projectController");
const { checkPlagiarism, globalPlagiarismReport } = require("../controllers/plagiarismController");
const { protect, recruiterOnly } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { createProjectValidator } = require("../middleware/validators/projectValidators");

router.route("/").get(getProjects).post(protect, createProjectValidator, validate, createProject);
router.route("/analytics").get(protect, getMyAnalytics);
router.route("/plagiarism/report").get(protect, recruiterOnly, globalPlagiarismReport);
router.route("/myprojects").get(protect, getMyProjects);
router.route("/:id").get(getProjectById);
router.route("/:id/sync").put(protect, syncProject);
router.route("/:id/plagiarism").get(protect, checkPlagiarism);

module.exports = router;

