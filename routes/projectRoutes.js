const express = require("express");
const router = express.Router();
const {
  createProject,
  getProjects,
  getMyProjects,
  getProjectById,
  syncProject,
} = require("../controllers/projectController");
const { protect } = require("../middleware/authMiddleware");

router.route("/").get(getProjects).post(protect, createProject);
router.route("/myprojects").get(protect, getMyProjects);
router.route("/:id").get(getProjectById);
router.route("/:id/sync").put(protect, syncProject);

module.exports = router;
