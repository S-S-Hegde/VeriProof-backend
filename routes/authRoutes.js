const express = require("express");
const router = express.Router();
const User = require("../models/User");
const {
  registerUser,
  authUser,
  getUserProfile,
  updateUserProfile,
  uploadResume,
  getPendingResumes,
  verifyResume,
  getSavedProjects,
  toggleSavedProject,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");

const { protect, recruiterOnly } = require("../middleware/authMiddleware");

// ====================== FILE UPLOAD INFRASTRUCTURE ======================

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cloudinary = require("../utils/cloudinary");

const isCloudinaryConfigured = () => !!process.env.CLOUDINARY_CLOUD_NAME;

// Ensure uploads directories exist for local fallback
const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };
ensureDir(path.join(__dirname, "..", "uploads", "profiles"));
ensureDir(path.join(__dirname, "..", "uploads", "resumes"));

// Use memory storage (works for both Cloudinary and local write)
const storage = multer.memoryStorage();

const PROFILE_IMAGE_LIMIT_MB = 2;
const RESUME_FILE_LIMIT_MB = 5;

const imageUpload = multer({
  storage,
  limits: { fileSize: PROFILE_IMAGE_LIMIT_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (JPG, PNG, WEBP, GIF)"), false);
    }
  },
});

const resumeUpload = multer({
  storage,
  limits: { fileSize: RESUME_FILE_LIMIT_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only resume files are allowed (PDF, DOC, DOCX, TXT)"), false);
    }
  },
});

// Helper: save buffer to local disk, return URL
const saveLocal = (buffer, originalName, subDir) => {
  const ext = path.extname(originalName) || ".bin";
  const filename = `${crypto.randomBytes(12).toString("hex")}${ext}`;
  const filePath = path.join(__dirname, "..", "uploads", subDir, filename);
  fs.writeFileSync(filePath, buffer);
  return `/uploads/${subDir}/${filename}`;
};

// ====================== PROFILE IMAGE UPLOAD ======================
router.post(
  "/profile/image",
  protect,
  imageUpload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file received" });
      }

      let fileUrl;

      if (isCloudinaryConfigured()) {
        // Upload to Cloudinary with optimizations
        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            {
              folder: "veriproof/profiles",
              resource_type: "image",
              transformation: [
                { width: 800, height: 800, crop: "limit" },
                { quality: "auto:good" },
                { fetch_format: "auto" },
              ],
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          ).end(req.file.buffer);
        });
        fileUrl = result.secure_url;
      } else {
        // Local fallback: save to /uploads/profiles/
        fileUrl = saveLocal(req.file.buffer, req.file.originalname, "profiles");
      }

      // Save URL to user profile
      const user = await User.findById(req.user._id);
      user.profileImage = fileUrl;
      await user.save();

      res.json({
        success: true,
        profileImage: fileUrl,
        message: "Profile image uploaded successfully",
      });
    } catch (err) {
      console.error("Image upload error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          message: `Image exceeds ${PROFILE_IMAGE_LIMIT_MB}MB limit. Please use a smaller image.`,
        });
      }
      res.status(500).json({ message: "Failed to upload image. Please try again." });
    }
  }
);

// ====================== RESUME FILE UPLOAD ======================
router.post(
  "/profile/resume-file",
  protect,
  resumeUpload.single("resume"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No resume file received" });
      }

      let fileUrl;

      if (isCloudinaryConfigured()) {
        const result = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            {
              folder: "veriproof/resumes",
              resource_type: "raw",
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          ).end(req.file.buffer);
        });
        fileUrl = result.secure_url;
      } else {
        fileUrl = saveLocal(req.file.buffer, req.file.originalname, "resumes");
      }

      // Update user resume fields
      const user = await User.findById(req.user._id);
      user.resumeUrl = fileUrl;
      user.resumeStatus = "Pending Evaluation";
      await user.save();

      // Trigger async resume parsing and intelligence pipeline (non-blocking)
      const { runAnalysis } = require("../services/resumeIntelligenceService");
      runAnalysis(user._id, fileUrl).catch((err) => {
        console.error("[Resume Intelligence] Asynchronous process crash:", err);
      });

      res.json({
        success: true,
        resumeUrl: fileUrl,
        resumeStatus: "Pending Evaluation",
        fileName: req.file.originalname,
        fileSize: req.file.size,
        message: "Resume uploaded successfully. Analysis started.",
      });
    } catch (err) {
      console.error("Resume upload error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          message: `Resume exceeds ${RESUME_FILE_LIMIT_MB}MB limit.`,
        });
      }
      res.status(500).json({ message: "Failed to upload resume. Please try again." });
    }
  }
);

// GET /api/users/profile/resume-analysis
router.get("/profile/resume-analysis", protect, async (req, res) => {
  try {
    const ResumeAnalysis = require("../models/ResumeAnalysis");
    const analysis = await ResumeAnalysis.findOne({ candidateId: req.user._id, active: true });
    
    if (!analysis) {
      return res.status(404).json({ message: "No active resume analysis found." });
    }

    res.json({
      status: analysis.status,
      progress: analysis.progress,
      stage: analysis.stage,
      estimatedRemainingStage: analysis.estimatedRemainingStage,
      claims: analysis.claims,
      analysis: analysis.analysis,
      error: analysis.error,
      lastUpdated: analysis.updatedAt || analysis.createdAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ====================== OTHER ROUTES ======================

router.post("/", registerUser);
router.post("/login", authUser);
router.post("/forgotpassword", forgotPassword);
router.put("/resetpassword/:resettoken", resetPassword);
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, updateUserProfile);
router.get("/profile/saved-projects", protect, recruiterOnly, getSavedProjects);
router.put("/profile/saved-projects/:projectId", protect, recruiterOnly, toggleSavedProject);

// Resume Routes
router.put("/profile/resume", protect, uploadResume);
router.get("/resumes/pending", protect, recruiterOnly, getPendingResumes);
router.put("/:id/verify-resume", protect, recruiterOnly, verifyResume);

module.exports = router;
