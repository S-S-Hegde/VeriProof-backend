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
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");
const { protect, recruiterOnly } = require("../middleware/authMiddleware");

router.post("/", registerUser);
router.post("/login", authUser);
router.post("/forgotpassword", forgotPassword);
router.put("/resetpassword/:resettoken", resetPassword);
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, updateUserProfile);

// Image Upload Protocol
const multer = require("multer");
const path   = require("path");
const fs     = require("fs");

// Use local disk storage — works with zero cloud credentials
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `profile_${req.user._id}_${Date.now()}${ext}`);
  },
});

// ─── 2 MB hard cap — multer rejects before Cloudinary/disk touch it ───
const PROFILE_IMAGE_LIMIT_MB = 2;
const upload = multer({
  storage,
  limits: { fileSize: PROFILE_IMAGE_LIMIT_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed (jpeg, png, webp, gif)"), false);
  },
});

router.post("/profile/image", protect, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image file received" });

    // If Cloudinary is configured, use it — otherwise serve from local /uploads
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    let imageUrl;

    if (cloudName) {
      // Cloudinary path
      const cloudinary = require("../utils/cloudinary");
      const fileBuffer  = fs.readFileSync(req.file.path);
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: "veriproof/profiles" },
          (error, result) => { if (error) reject(error); else resolve(result); }
        ).end(fileBuffer);
      });
      fs.unlinkSync(req.file.path); // clean up local copy
      imageUrl = result.secure_url;
    } else {
      // Local storage path — Vite proxy will serve /uploads from the backend port
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const user = await User.findById(req.user._id);
    user.profileImage = imageUrl;
    await user.save();

    res.json({ profileImage: imageUrl });
  } catch (err) {
    // Clean up file on error
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    // Surface multer-specific size errors cleanly
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: `Image exceeds ${PROFILE_IMAGE_LIMIT_MB}MB limit. Please compress and retry.`,
      });
    }
    res.status(500).json({ message: err.message });
  }
});

// Multer error middleware — catches LIMIT_FILE_SIZE thrown *before* the route handler
router.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(413).json({
      message: `Image exceeds ${PROFILE_IMAGE_LIMIT_MB}MB limit. Please compress and retry.`,
    });
  }
  next(err);
});

// Resume Routes
router.put("/profile/resume", protect, uploadResume);
router.get("/resumes/pending", protect, recruiterOnly, getPendingResumes);
router.put("/:id/verify-resume", protect, recruiterOnly, verifyResume);

module.exports = router;
