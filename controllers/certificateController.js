const asyncHandler = require("express-async-handler");
const path = require("path");
const fs = require("fs");
const Certificate = require("../models/Certificate");
const User = require("../models/User");

// @desc    Get all certificates for the authenticated user
// @route   GET /api/certificates
// @access  Private (Candidates & Recruiters)
const getMyCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(certificates);
});

// @desc    Upload and create a new verified certificate
// @route   POST /api/certificates
// @access  Private (Candidates & Recruiters)
const createCertificate = asyncHandler(async (req, res) => {
  const { title, issuer, issueDate, expiryDate, credentialId, credentialUrl, skills } = req.body;

  if (!title || !issuer) {
    res.status(400);
    throw new Error("Certificate title and issuing organization are required.");
  }

  let fileUrl = "";
  let fileType = "document";

  if (req.file) {
    fileUrl = `/uploads/certificates/${req.file.filename}`;
    fileType = req.file.mimetype || "application/pdf";
  } else if (req.body.fileUrl) {
    fileUrl = req.body.fileUrl;
  }

  let parsedSkills = [];
  if (Array.isArray(skills)) {
    parsedSkills = skills;
  } else if (typeof skills === "string") {
    try {
      parsedSkills = JSON.parse(skills);
    } catch {
      parsedSkills = skills.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  const certificate = await Certificate.create({
    user: req.user._id,
    title: title.trim(),
    issuer: issuer.trim(),
    issueDate: issueDate ? new Date(issueDate) : new Date(),
    expiryDate: expiryDate ? new Date(expiryDate) : undefined,
    credentialId: (credentialId || "").trim(),
    credentialUrl: (credentialUrl || "").trim(),
    fileUrl,
    fileType,
    skills: parsedSkills,
    verificationStatus: "Verified",
    trustScoreBonus: 5,
    xpAwarded: 250,
  });

  // Award XP and bump trust score for candidate
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      if (!user.skillProgress) {
        user.skillProgress = {
          skills: [],
          achievements: [],
          totalXp: 0,
          level: 1,
          progressPercent: 0,
          verificationScore: 80,
          githubScore: 80,
          trustScore: 85,
          streakDays: 1,
          verifiedCount: 0,
          unlockedCount: 0,
          totalSkills: 0,
          completedAssessments: 0,
        };
      }

      user.skillProgress.totalXp = (user.skillProgress.totalXp || 0) + 250;
      user.skillProgress.level = Math.max(1, Math.floor(user.skillProgress.totalXp / 500) + 1);
      user.skillProgress.trustScore = Math.min(99, (user.skillProgress.trustScore || 80) + 3);
      user.skillProgress.verifiedCount = (user.skillProgress.verifiedCount || 0) + 1;
      user.skillProgress.lastUpdated = new Date();

      await user.save();
    }
  } catch (scoreErr) {
    console.warn("[Certificate] Failed to update user skill progress:", scoreErr.message);
  }

  res.status(201).json(certificate);
});

// @desc    Delete a certificate
// @route   DELETE /api/certificates/:id
// @access  Private (Owner only)
const deleteCertificate = asyncHandler(async (req, res) => {
  const certificate = await Certificate.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!certificate) {
    res.status(404);
    throw new Error("Certificate not found or unauthorized.");
  }

  if (certificate.fileUrl && certificate.fileUrl.startsWith("/uploads/certificates/")) {
    const filePath = path.join(__dirname, "..", certificate.fileUrl);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn("[Certificate] File unlink error:", err.message);
      }
    }
  }

  await Certificate.deleteOne({ _id: certificate._id });

  res.json({ message: "Certificate removed successfully.", id: req.params.id });
});

module.exports = {
  getMyCertificates,
  createCertificate,
  deleteCertificate,
};
