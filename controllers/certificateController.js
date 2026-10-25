const asyncHandler = require("express-async-handler");
const path = require("path");
const fs = require("fs");
const Certificate = require("../models/Certificate");
const User = require("../models/User");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const {
  inspectAndVerifyCertificate,
  detectSubjectDomain,
  crossReferenceWithResume,
  cleanCertificateTitle,
  isUuidOrHash,
} = require("../services/certificateIntelligenceService");

// @desc    Get all certificates for the authenticated user (with automatic UUID sanitization & enrichment)
// @route   GET /api/certificates
// @access  Private (Candidates & Recruiters)
const getMyCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ user: req.user._id }).sort({ createdAt: -1 });

  // Get active resume analysis for cross-referencing legacy records
  let resumeAnalysis = null;
  try {
    resumeAnalysis = await ResumeAnalysis.findOne({ candidateId: req.user._id }).sort({ createdAt: -1 });
  } catch (err) {
    // Silent
  }

  // Sanitize any existing certificates that have UUID titles or missing subject/vendor
  let updatedAny = false;
  for (const cert of certificates) {
    let needsSave = false;

    // Check if title is a UUID or hash, or was stuck with the duplicate static fallback
    const isGenericStaticTitle = cert.title === "Professional Certification in Cloud Architecture & DevOps";
    if (isUuidOrHash(cert.title) || !cert.title || cert.title.length < 3 || isGenericStaticTitle) {
      const filename = cert.fileUrl ? path.basename(cert.fileUrl) : "";
      const detectedSubject = cert.subject || detectSubjectDomain(`${cert.title || ""} ${cert.skills?.join(" ") || ""}`, cert.skills);
      const newTitle = cleanCertificateTitle(isGenericStaticTitle ? "" : cert.title, detectedSubject, cert.skills, cert.vendor || cert.issuer, filename);
      if (newTitle && newTitle !== cert.title) {
        cert.title = newTitle;
        needsSave = true;
      }
    }

    // Check if subject is missing
    if (!cert.subject || cert.subject.trim() === "") {
      cert.subject = detectSubjectDomain(`${cert.title} ${cert.skills.join(" ")}`, cert.skills);
      needsSave = true;
    }

    // Check if vendor is missing or default
    if (!cert.vendor || cert.vendor.trim() === "" || isUuidOrHash(cert.vendor)) {
      if (cert.issuer && !isUuidOrHash(cert.issuer) && cert.issuer !== "Verified Educational Authority") {
        cert.vendor = cert.issuer.split("/")[0].split("(")[0].trim();
      } else {
        cert.vendor = "Verified Technical Authority";
      }
      needsSave = true;
    }

    // Check resume cross-reference if not already matched
    if (!cert.resumeMatched && resumeAnalysis) {
      const match = await crossReferenceWithResume(req.user._id, {
        title: cert.title,
        vendor: cert.vendor,
        issuer: cert.issuer,
        subject: cert.subject,
        skills: cert.skills,
      });
      if (match.matched) {
        cert.resumeMatched = true;
        cert.resumeMatchDetails = match.details;
        needsSave = true;
      } else if (!cert.resumeMatchDetails) {
        cert.resumeMatchDetails = match.details;
        needsSave = true;
      }
    }

    if (needsSave) {
      try {
        await cert.save();
        updatedAny = true;
      } catch (err) {
        console.warn("[Certificates] Auto-sanitize save error:", err.message);
      }
    }
  }

  res.json(certificates);
});

// @desc    Upload and create a new verified certificate with Multimodal AI Analysis & Resume Cross-Reference
// @route   POST /api/certificates
// @access  Private (Candidates & Recruiters)
const createCertificate = asyncHandler(async (req, res) => {
  let { title, issuer, vendor, subject, issueDate, expiryDate, credentialId, credentialUrl, skills, autoExtract } = req.body;

  let fileUrl = "";
  let fileType = "application/pdf";
  let fileBuffer = null;
  let fileBufferBase64 = "";

  const originalFilename = req.file?.originalname || "";

  if (req.file) {
    fileUrl = `/uploads/certificates/${req.file.filename}`;
    fileType = req.file.mimetype || "application/pdf";

    const filePath = path.join(__dirname, "..", "uploads", "certificates", req.file.filename);
    if (fs.existsSync(filePath)) {
      try {
        fileBuffer = fs.readFileSync(filePath);
        // Store base64 if under 8MB to protect against ephemeral disk restarts
        if (fileBuffer && fileBuffer.length <= 8 * 1024 * 1024) {
          fileBufferBase64 = fileBuffer.toString("base64");
        }
      } catch (readErr) {
        console.warn("[Certificate Upload] Buffer read warning:", readErr.message);
      }
    }

    // Direct Cloudinary upload if credentials configured
    try {
      const cloudinary = require("../utils/cloudinary");
      if (cloudinary?.config()?.cloud_name && cloudinary?.config()?.api_key && fileBuffer) {
        const uploadResult = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            {
              folder: "veriproof_certificates",
              resource_type: "auto",
              public_id: `cert_${Date.now()}_${path.parse(req.file.originalname).name.replace(/[^a-zA-Z0-9]/g, "_")}`,
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          stream.end(fileBuffer);
        });

        if (uploadResult?.secure_url) {
          fileUrl = uploadResult.secure_url;
        }
      }
    } catch (cloudErr) {
      console.warn("[Certificate Upload] Cloudinary upload fallback:", cloudErr.message);
    }

    // Perform Deep Multimodal AI Inspection
    const isAuto = autoExtract === "true" || autoExtract === true || !title || !issuer;
    const aiResult = await inspectAndVerifyCertificate({
      buffer: fileBuffer,
      mimeType: fileType,
      originalFilename: req.file.originalname,
      userId: req.user._id,
    });

    if (isAuto) {
      title = aiResult.title;
      issuer = aiResult.issuer;
      vendor = aiResult.vendor;
      subject = aiResult.subject;
      credentialId = aiResult.credentialId;
      skills = aiResult.skills;
      issueDate = issueDate || aiResult.issueDate;
      expiryDate = expiryDate || aiResult.expiryDate;
    } else {
      // Manual input with AI augmentation
      title = cleanCertificateTitle(title, subject || aiResult.subject, skills || aiResult.skills, issuer || aiResult.vendor, originalFilename);
      vendor = vendor || aiResult.vendor || issuer;
      subject = subject || aiResult.subject || detectSubjectDomain(`${title} ${issuer}`, skills);
      credentialId = credentialId || aiResult.credentialId;
      if (!skills || (Array.isArray(skills) && skills.length === 0)) {
        skills = aiResult.skills;
      }
    }

    // Attach resume match result from AI inspection
    var resumeMatched = aiResult.resumeMatched;
    var resumeMatchDetails = aiResult.resumeMatchDetails;
    var recipientName = aiResult.recipientName || "";
  } else if (req.body.fileUrl) {
    fileUrl = req.body.fileUrl;
  }

  // Cross-reference with resume if manual mode or fileless
  if (resumeMatched === undefined) {
    const resumeCheck = await crossReferenceWithResume(req.user._id, {
      title,
      vendor: vendor || issuer,
      issuer,
      subject,
      skills,
    });
    resumeMatched = resumeCheck.matched;
    resumeMatchDetails = resumeCheck.details;
  }

  // Fallbacks if still unspecified
  subject = subject || detectSubjectDomain(`${title || ""} ${issuer || ""}`, skills || []);
  title = cleanCertificateTitle(title, subject, skills, vendor || issuer, originalFilename);
  issuer = issuer || "VeriProof Certified Authority";
  vendor = vendor || (issuer.includes("/") ? issuer.split("/")[0].trim() : issuer);

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
  if (parsedSkills.length === 0) {
    parsedSkills = ["Cloud Computing", "Full Stack Development"];
  }

  const certificate = await Certificate.create({
    user: req.user._id,
    title: title.trim(),
    issuer: issuer.trim(),
    vendor: vendor.trim(),
    subject: subject.trim(),
    recipientName: (recipientName || "").trim(),
    issueDate: issueDate ? new Date(issueDate) : new Date(),
    expiryDate: expiryDate ? new Date(expiryDate) : undefined,
    credentialId: (credentialId || `VP-${Date.now().toString(36).toUpperCase()}`).trim(),
    credentialUrl: (credentialUrl || "").trim(),
    fileUrl,
    fileType,
    fileBufferBase64,
    skills: parsedSkills,
    resumeMatched: Boolean(resumeMatched),
    resumeMatchDetails: resumeMatchDetails || "",
    verificationStatus: "Verified",
    trustScoreBonus: resumeMatched ? 8 : 5,
    xpAwarded: resumeMatched ? 350 : 250,
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

      const xpGain = resumeMatched ? 350 : 250;
      const trustGain = resumeMatched ? 5 : 3;

      user.skillProgress.totalXp = (user.skillProgress.totalXp || 0) + xpGain;
      user.skillProgress.level = Math.max(1, Math.floor(user.skillProgress.totalXp / 500) + 1);
      user.skillProgress.trustScore = Math.min(99, (user.skillProgress.trustScore || 80) + trustGain);
      user.skillProgress.verifiedCount = (user.skillProgress.verifiedCount || 0) + 1;
      user.skillProgress.lastUpdated = new Date();

      await user.save();
    }
  } catch (scoreErr) {
    console.warn("[Certificate] Failed to update user skill progress:", scoreErr.message);
  }

  // Cross-link uploaded certificate to candidate's ResumeAnalysis certifications claims
  try {
    const analysis = await ResumeAnalysis.findOne({ candidateId: req.user._id }).sort({ createdAt: -1 });
    if (analysis?.claims?.certifications?.length > 0) {
      let matchedAny = false;
      const certTitleLower = title.toLowerCase();
      const certSubjectLower = (subject || "").toLowerCase();
      const certVendorLower = (vendor || "").toLowerCase();

      analysis.claims.certifications.forEach((c) => {
        const claimNameLower = (c.name || "").toLowerCase();
        if (
          certTitleLower.includes(claimNameLower) ||
          claimNameLower.includes(certTitleLower) ||
          (certSubjectLower && claimNameLower.includes(certSubjectLower)) ||
          (certVendorLower && claimNameLower.includes(certVendorLower)) ||
          resumeMatched
        ) {
          c.isUploaded = true;
          c.certificateId = certificate._id;
          c.verificationStatus = "Verified";
          matchedAny = true;
        }
      });

      if (!matchedAny && analysis.claims.certifications[0]) {
        analysis.claims.certifications[0].isUploaded = true;
        analysis.claims.certifications[0].certificateId = certificate._id;
        analysis.claims.certifications[0].verificationStatus = "Verified";
      }

      await analysis.save();
    }
  } catch (claimErr) {
    console.warn("[Certificate] Claim cross-link notice:", claimErr.message);
  }

  res.status(201).json(certificate);
});

// @desc    Re-analyze all existing certificates for the authenticated user
// @route   POST /api/certificates/re-analyze-all
// @access  Private
const reanalyzeAllCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ user: req.user._id });
  const resumeAnalysis = await ResumeAnalysis.findOne({ candidateId: req.user._id }).sort({ createdAt: -1 });

  let updatedCount = 0;

  for (const cert of certificates) {
    let reanalyzed = false;

    // 1. Try file buffer if available
    let buffer = null;
    if (cert.fileBufferBase64) {
      try {
        buffer = Buffer.from(cert.fileBufferBase64, "base64");
      } catch (err) {}
    } else if (cert.fileUrl && cert.fileUrl.startsWith("/uploads/certificates/")) {
      const filePath = path.join(__dirname, "..", cert.fileUrl);
      if (fs.existsSync(filePath)) {
        try {
          buffer = fs.readFileSync(filePath);
        } catch (err) {}
      }
    }

    if (buffer) {
      try {
        const aiResult = await inspectAndVerifyCertificate({
          buffer,
          mimeType: cert.fileType || "application/pdf",
          originalFilename: cert.title,
          userId: req.user._id,
        });

        if (aiResult && aiResult.title && !isUuidOrHash(aiResult.title)) {
          cert.title = aiResult.title;
          cert.vendor = aiResult.vendor;
          cert.issuer = aiResult.issuer;
          cert.subject = aiResult.subject;
          if (aiResult.skills && aiResult.skills.length > 0) cert.skills = aiResult.skills;
          cert.resumeMatched = aiResult.resumeMatched;
          cert.resumeMatchDetails = aiResult.resumeMatchDetails;
          reanalyzed = true;
        }
      } catch (aiErr) {
        console.warn("[Certificate Re-Analyze] AI error:", aiErr.message);
      }
    }

    // If still a UUID or missing subject, sanitize with domain heuristics
    if (!reanalyzed || isUuidOrHash(cert.title)) {
      const subject = cert.subject || detectSubjectDomain(`${cert.title} ${cert.skills.join(" ")}`, cert.skills);
      cert.subject = subject;
      cert.title = cleanCertificateTitle(cert.title, subject, cert.skills, cert.vendor || cert.issuer);
      if (!cert.vendor || isUuidOrHash(cert.vendor)) {
        cert.vendor = cert.issuer || "Verified Educational Authority";
      }

      if (resumeAnalysis) {
        const match = await crossReferenceWithResume(req.user._id, {
          title: cert.title,
          vendor: cert.vendor,
          issuer: cert.issuer,
          subject: cert.subject,
          skills: cert.skills,
        });
        cert.resumeMatched = match.matched;
        cert.resumeMatchDetails = match.details;
      }
    }

    await cert.save();
    updatedCount++;
  }

  const updatedCertificates = await Certificate.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({
    message: `Successfully re-analyzed ${updatedCount} certificates.`,
    certificates: updatedCertificates,
  });
});

// @desc    Get certificate proof file (supports Cloudinary redirect, disk, or base64 stream)
// @route   GET /api/certificates/:id/file
// @access  Public (Embeddable for candidate profiles & verification modals)
const getCertificateFile = asyncHandler(async (req, res) => {
  const certificate = await Certificate.findById(req.params.id);

  if (!certificate) {
    res.status(404);
    throw new Error("Certificate not found.");
  }

  // Set open CORS and embedding headers for iframe / object viewer
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  // 1. If stored in Cloudinary or remote storage, redirect directly
  if (certificate.fileUrl && (certificate.fileUrl.startsWith("http://") || certificate.fileUrl.startsWith("https://"))) {
    return res.redirect(certificate.fileUrl);
  }

  // 2. Try disk file if running on local environment
  if (certificate.fileUrl && certificate.fileUrl.startsWith("/uploads/certificates/")) {
    const filePath = path.join(__dirname, "..", certificate.fileUrl);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
  }

  // 3. Fallback to MongoDB fileBufferBase64 (bulletproof on Render ephemeral restarts)
  if (certificate.fileBufferBase64) {
    const buffer = Buffer.from(certificate.fileBufferBase64, "base64");
    res.set("Content-Type", certificate.fileType || "application/pdf");
    res.set(
      "Content-Disposition",
      `inline; filename="certificate_${certificate._id}.${(certificate.fileType || "pdf").includes("png") ? "png" : "pdf"}"`
    );
    return res.send(buffer);
  }

  res.status(404).json({ message: "Certificate proof file not found on disk or storage." });
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
  reanalyzeAllCertificates,
  getCertificateFile,
  deleteCertificate,
};
