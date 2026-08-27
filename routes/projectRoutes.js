const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const {
  createProject,
  getProjects,
  getMyProjects,
  getProjectById,
  updateProject,
  deleteProject,
  uploadProjectAttachment,
  syncProject,
  getMyAnalytics,
  verifyProjectDualSource,
} = require("../controllers/projectController");
const { checkPlagiarism, globalPlagiarismReport } = require("../controllers/plagiarismController");
const { protect, recruiterOnly } = require("../middleware/authMiddleware");
const validate = require("../middleware/validate");
const { createProjectValidator } = require("../middleware/validators/projectValidators");

const docUploadDir = path.join(__dirname, "../uploads/documents");
if (!fs.existsSync(docUploadDir)) {
  fs.mkdirSync(docUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, docUploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    const hash = crypto.randomBytes(12).toString("hex");
    cb(null, `${hash}${ext}`);
  },
});

const attachmentUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

router.route("/").get(getProjects).post(protect, createProjectValidator, validate, createProject);
router.route("/analytics").get(protect, getMyAnalytics);
router.route("/plagiarism/report").get(protect, recruiterOnly, globalPlagiarismReport);
router.route("/myprojects").get(protect, getMyProjects);
router
  .route("/:id")
  .get(getProjectById)
  .put(protect, updateProject)
  .delete(protect, deleteProject);
router.post("/:id/attachments", protect, attachmentUpload.single("attachment"), uploadProjectAttachment);
router.post("/:id/verify-live", protect, verifyProjectDualSource);
router.route("/:id/sync").put(protect, syncProject);
router.route("/:id/plagiarism").get(protect, checkPlagiarism);

module.exports = router;

