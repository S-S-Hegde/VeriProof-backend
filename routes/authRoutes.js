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
} = require("../controllers/authController");
const { protect, recruiterOnly } = require("../middleware/authMiddleware");

router.post("/", registerUser);
router.post("/login", authUser);
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, updateUserProfile);

// Image Upload Protocol
const multer = require("multer");
const cloudinary = require("../utils/cloudinary");
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post("/profile/image", protect, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No Image Node Provided" });

    // Direct Cloudinary Uplink
    cloudinary.uploader.upload_stream(
      { folder: "veriproof/profiles" },
      async (error, result) => {
        if (error) return res.status(500).json({ message: "Cloudinary_Uplink_Failed" });

        const user = await User.findById(req.user._id);
        user.profileImage = result.secure_url;
        await user.save();

        res.json({ profileImage: result.secure_url });
      }
    ).end(req.file.buffer);

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Resume Routes
router.put("/profile/resume", protect, uploadResume);
router.get("/resumes/pending", protect, recruiterOnly, getPendingResumes);
router.put("/:id/verify-resume", protect, recruiterOnly, verifyResume);

module.exports = router;
