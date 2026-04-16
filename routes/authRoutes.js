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

// ====================== PROFILE IMAGE UPLOAD ======================

const multer = require("multer");
const cloudinary = require("../utils/cloudinary");   // Make sure this path is correct

// Use memory storage - Best practice when using Cloudinary
const storage = multer.memoryStorage();

const PROFILE_IMAGE_LIMIT_MB = 2;

const upload = multer({
  storage,
  limits: { fileSize: PROFILE_IMAGE_LIMIT_MB * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (jpeg, png, webp, gif)"), false);
    }
  },
});

// Profile Image Upload Route - Optimized for Cloudinary Free Tier
router.post(
  "/profile/image",
  protect,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file received" });
      }

      // Check if Cloudinary is configured
      if (!process.env.CLOUDINARY_CLOUD_NAME) {
        return res.status(500).json({ message: "Cloudinary is not configured" });
      }

      // Upload to Cloudinary with optimizations (saves credits & bandwidth)
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            folder: "veriproof/profiles",
            resource_type: "image",
            transformation: [
              { width: 800, height: 800, crop: "limit" },   // Resize if too big
              { quality: "auto:good" },                     // Best quality vs size
              { fetch_format: "auto" },                     // Auto WebP / AVIF
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        ).end(req.file.buffer);
      });

      // Save URL to user profile
      const user = await User.findById(req.user._id);
      user.profileImage = result.secure_url;
      await user.save();

      res.json({
        success: true,
        profileImage: result.secure_url,
        message: "Profile image uploaded successfully",
      });
    } catch (err) {
      console.error("Image upload error:", err);

      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          message: `Image exceeds ${PROFILE_IMAGE_LIMIT_MB}MB limit. Please use a smaller image.`,
        });
      }

      res.status(500).json({
        message: "Failed to upload image. Please try again.",
      });
    }
  }
);

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
