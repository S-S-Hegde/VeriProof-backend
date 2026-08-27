const express = require("express");
const router = express.Router();
const User = require("../models/User");
const {
  registerUser,
  authUser,
  verifyOtp,
  getUserProfile,
  updateUserProfile,
  uploadResume,
  getPendingResumes,
  verifyResume,
  getSavedProjects,
  toggleSavedProject,
  forgotPassword,
  resetPassword,
  deleteUserAccount,
  firebaseGoogleAuth,
  updateCompanyInfo,
  verifyCompanyEmail,
  verifySocialIdentity,
} = require("../controllers/authController");

const { protect, recruiterOnly } = require("../middleware/authMiddleware");
const { authLimiter, uploadLimiter } = require("../middleware/rateLimiter");
const validate = require("../middleware/validate");
const {
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  updateProfileValidator,
} = require("../middleware/validators/authValidators");

// ====================== FILE UPLOAD INFRASTRUCTURE ======================

const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cloudinary = require("../utils/cloudinary");

const isCloudinaryConfigured = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);
const PROFILE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Ensure uploads directories exist for local fallback
const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };
ensureDir(path.join(__dirname, "..", "uploads", "profiles"));
ensureDir(path.join(__dirname, "..", "uploads", "resumes"));

// Use memory storage (works for both Cloudinary and local write)
const storage = multer.memoryStorage();

const PROFILE_IMAGE_LIMIT_MB = 5;
const RESUME_FILE_LIMIT_MB = 5;

const imageUpload = multer({
  storage,
  limits: { fileSize: PROFILE_IMAGE_LIMIT_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else if (PROFILE_IMAGE_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (JPG, PNG, WEBP, GIF)"), false);
    }
  },
});

const receiveProfileImage = (req, res, next) => {
  imageUpload.single("image")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: `Image exceeds ${PROFILE_IMAGE_LIMIT_MB}MB limit. Please use a smaller image.`,
      });
    }
    return res.status(400).json({ message: error.message });
  });
};

const resumeUpload = multer({
  storage,
  limits: { fileSize: RESUME_FILE_LIMIT_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMime = [
      "application/pdf",
      "application/x-pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
      "application/octet-stream",
    ];
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExts = [".pdf", ".docx", ".doc", ".txt"];
    if (allowedMime.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only resume files are allowed (PDF, DOCX, TXT)"), false);
    }
  },
});

const receiveResume = (req, res, next) => {
  resumeUpload.single("resume")(req, res, (error) => {
    if (!error) return next();
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: `Resume exceeds ${RESUME_FILE_LIMIT_MB}MB limit.` });
    }
    return res.status(400).json({ message: error.message });
  });
};

// Helper: save buffer to local disk, return URL
const saveLocal = (buffer, originalName, subDir) => {
  const ext = path.extname(originalName) || ".bin";
  const filename = `${crypto.randomBytes(12).toString("hex")}${ext}`;
  const filePath = path.join(__dirname, "..", "uploads", subDir, filename);
  fs.writeFileSync(filePath, buffer);
  return `/uploads/${subDir}/${filename}`;
};

// Browser-provided MIME types can be spoofed. Confirm the uploaded bytes match
// one of the image formats accepted above before persisting anything.
const detectedImageType = (buffer) => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString())) return "image/gif";
  return null;
};

const isValidResumeFile = (file) => {
  if (!file || !file.buffer) return false;
  if (file.buffer.length >= 5 && file.buffer.subarray(0, 5).toString() === "%PDF-") return true;
  if (file.buffer.length >= 4 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b) return true;
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (file.mimetype === "text/plain" || ext === ".txt") return !file.buffer.includes(0x00);
  if (file.mimetype === "application/pdf") return file.buffer.subarray(0, 5).toString() === "%PDF-";
  if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return file.buffer.length >= 4 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
  }
  return false;
};

const deleteLocalUpload = (fileUrl) => {
  if (!fileUrl?.startsWith("/uploads/profiles/")) return;
  const profilesDir = path.resolve(__dirname, "..", "uploads", "profiles");
  const filePath = path.resolve(__dirname, "..", fileUrl.slice(1));
  if (path.dirname(filePath) === profilesDir && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// ====================== PROFILE IMAGE UPLOAD ======================
router.post(
  "/profile/image",
  protect,
  uploadLimiter,
  receiveProfileImage,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file received" });
      }

      const imageType = detectedImageType(req.file.buffer) || req.file.mimetype;
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Convert buffer directly to Base64 Data URL for 100% reliable database persistence
      const base64String = req.file.buffer.toString("base64");
      const dataUrl = `data:${imageType};base64,${base64String}`;

      // Save Data URL directly to user document in MongoDB
      user.profileImage = dataUrl;
      await user.save();

      res.json({
        success: true,
        profileImage: user.profileImage,
        message: "Profile image stored in database successfully",
      });
    } catch (err) {
      console.error("Image upload error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "Image size exceeds limit." });
      }
      res.status(500).json({ message: "Failed to upload and store profile image in database." });
    }
  }
);


// ====================== RESUME FILE UPLOAD ======================
router.post(
  "/profile/resume-file",
  protect,
  uploadLimiter,
  receiveResume,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No resume file received" });
      }
      if (!isValidResumeFile(req.file)) {
        return res.status(400).json({ message: "The uploaded resume does not match its declared file format." });
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
      runAnalysis(user._id, fileUrl, {
        buffer: req.file.buffer,
        originalFileName: req.file.originalname,
        mimeType: req.file.mimetype,
      }).catch((err) => {
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
    const RecruiterApplicant = require("../models/RecruiterApplicant");

    let analysis = await ResumeAnalysis.findOne({ 
      $or: [
        { candidateId: req.user._id },
        { candidateId: String(req.user._id) }
      ],
      active: true 
    });

    const isUserAnalyzed = req.user.resumeStatus === "Analyzed" || ["repository_analysis", "technical_assessment", "verification_complete"].includes(req.user.pipelineStage);

    // If an analysis document already exists for this candidate
    if (analysis) {
      const isComplete = analysis.status === "Analysis Complete" || analysis.status === "Completed" || isUserAnalyzed;
      return res.json({
        status: isComplete ? "Analysis Complete" : (analysis.status || "Parsing"),
        progress: isComplete ? 100 : (analysis.progress !== undefined ? analysis.progress : 100),
        stage: isComplete ? "Ready" : (analysis.stage || "Ready"),
        estimatedRemainingStage: isComplete ? "Complete" : (analysis.estimatedRemainingStage || "Complete"),
        claims: analysis.claims || { skills: [] },
        analysis: analysis.analysis || {},
        error: analysis.error || "",
        lastUpdated: analysis.updatedAt || analysis.createdAt,
      });
    }

    // If user's resume is already marked Analyzed on User model
    if (isUserAnalyzed) {
      return res.json({
        status: "Analysis Complete",
        progress: 100,
        stage: "Ready",
        estimatedRemainingStage: "Complete",
        claims: { skills: [] },
        analysis: {},
        error: "",
        lastUpdated: new Date(),
      });
    }

    // 1. Check if user is an invited candidate with pre-analyzed recruiter intake record
    const isInvited = req.user.origin === "recruiter_invited";
    const applicant = await RecruiterApplicant.findOne({
      $or: [
        { candidateUser: req.user._id },
        { extractedEmail: req.user.email },
        { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
      ]
    }).sort({ createdAt: -1 });

    if (isInvited && applicant) {
      // Hydrate from recruiter intake
      const applicantSkills = (applicant.matchedSkills || applicant.claimedSkills || []).map(
        s => typeof s === "string" ? s : s.skill || s.name || ""
      ).filter(Boolean);

      const fallbackSkills = applicantSkills.length > 0 ? applicantSkills : ["Software Engineering", "Full Stack Development", "System Architecture", "API Design"];
      const formattedSkills = fallbackSkills.map((s, idx) => ({
        claim_id: `claim_${idx + 1}`,
        name: s,
        skill: s,
        context: "Pre-verified technical skill from candidate resume & recruiter intake",
        sourceQuote: s,
      }));

      analysis = await ResumeAnalysis.findOneAndUpdate(
        { candidateId: req.user._id },
        {
          candidateId: req.user._id,
          resumeUrl: applicant.fileUrl || req.user.resumeUrl || "/uploads/recruiter-resumes/pre_analyzed.pdf",
          originalFileName: applicant.originalFileName || "candidate_resume.pdf",
          mimeType: applicant.mimeType || "application/pdf",
          claims: {
            skills: formattedSkills,
            name: req.user.name,
            email: req.user.email,
            summary: applicant.resumeText || "Candidate technical profile pre-analyzed during recruiter intake."
          },
          analysis: applicant.analysis || { summary: "Technical assessment blueprint prepared from resume analysis." },
          status: "Analysis Complete",
          progress: 100,
          stage: "Ready",
          active: true,
          processedAt: applicant.processedAt || new Date(),
        },
        { upsert: true, new: true }
      );

      return res.json({
        status: analysis.status,
        progress: analysis.progress,
        stage: analysis.stage,
        estimatedRemainingStage: analysis.estimatedRemainingStage || "Complete",
        claims: analysis.claims,
        analysis: analysis.analysis,
        error: "",
        lastUpdated: analysis.updatedAt,
      });
    }

    // 2. For self-registered candidates with a resume pending evaluation:
    if (req.user.resumeUrl && req.user.resumeStatus === "Pending Evaluation") {
      return res.json({
        status: "Parsing",
        progress: 35,
        stage: "Parsing uploaded document...",
        estimatedRemainingStage: "Extracting skills",
        claims: { skills: [] },
        analysis: {},
        error: "",
        lastUpdated: new Date(),
      });
    }

    // 3. No resume uploaded yet
    return res.json({
      status: "Not Submitted",
      progress: 0,
      stage: "Awaiting Resume Upload",
      estimatedRemainingStage: "Not Started",
      claims: { skills: [] },
      analysis: {},
      error: "",
      lastUpdated: new Date(),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/users/profile/resume-analyses - immutable analysis/claims history
router.get("/profile/resume-analyses", protect, async (req, res) => {
  try {
    const ResumeAnalysis = require("../models/ResumeAnalysis");
    const analyses = await ResumeAnalysis.find({ candidateId: req.user._id })
      .sort({ createdAt: -1 })
      .select("status progress stage claims analysis active resumeUrl originalFileName mimeType processedAt createdAt error");
    res.json(analyses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Mandatory Firebase Google OAuth Identity Route
router.post("/firebase-auth", authLimiter, firebaseGoogleAuth);

// Recruiter Onboarding & Verification Routes
router.post("/recruiter/company-info", protect, recruiterOnly, updateCompanyInfo);
router.post("/recruiter/verify-company-email", protect, recruiterOnly, verifyCompanyEmail);
router.post("/verify-social-proof", verifySocialIdentity);

router.post("/", authLimiter, registerValidator, validate, registerUser);
router.post("/login", authLimiter, loginValidator, validate, authUser);
router.post("/verify-otp", authLimiter, verifyOtp);
router.post("/forgotpassword", authLimiter, forgotPasswordValidator, validate, forgotPassword);
router.put("/resetpassword/:resettoken", authLimiter, resetPassword);
router.post("/resetpassword", authLimiter, resetPassword);
router.put("/resetpassword", authLimiter, resetPassword);
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, updateProfileValidator, validate, updateUserProfile);
router.delete("/profile", protect, deleteUserAccount);
router.get("/profile/saved-projects", protect, recruiterOnly, getSavedProjects);
router.put("/profile/saved-projects/:projectId", protect, recruiterOnly, toggleSavedProject);

// Resume Routes
router.put("/profile/resume", protect, uploadResume);
router.get("/resumes/pending", protect, recruiterOnly, getPendingResumes);
router.put("/:id/verify-resume", protect, recruiterOnly, verifyResume);

module.exports = router;
