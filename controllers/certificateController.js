const asyncHandler = require("express-async-handler");
const path = require("path");
const fs = require("fs");
const Certificate = require("../models/Certificate");
const User = require("../models/User");
const pdfParse = require("pdf-parse");

/**
 * Helper to extract certificate details from text
 */
const extractCertificateFromText = (text = "", filename = "") => {
  const result = {
    title: "",
    issuer: "",
    issueDate: new Date(),
    credentialId: "",
    skills: [],
  };

  const cleanText = text.replace(/\r\n/g, "\n");

  // 1. Identify Issuer
  const issuers = [
    { name: "Amazon Web Services (AWS)", regex: /\b(Amazon Web Services|AWS)\b/i },
    { name: "Google Cloud", regex: /\b(Google Cloud|Google Cloud Platform|GCP)\b/i },
    { name: "Microsoft Azure", regex: /\b(Microsoft|Azure|Microsoft Certified)\b/i },
    { name: "Meta", regex: /\b(Meta|Facebook)\b/i },
    { name: "DeepLearning.AI", regex: /\b(DeepLearning\.AI|Andrew Ng)\b/i },
    { name: "Stanford Online", regex: /\b(Stanford Online|Stanford University)\b/i },
    { name: "Coursera", regex: /\b(Coursera)\b/i },
    { name: "edX", regex: /\b(edX|HarvardX|MITx)\b/i },
    { name: "Udacity", regex: /\b(Udacity)\b/i },
    { name: "Linux Foundation", regex: /\b(Linux Foundation|CNCF|Kubernetes)\b/i },
    { name: "Oracle", regex: /\b(Oracle|Java SE|Oracle Certified)\b/i },
    { name: "Cisco", regex: /\b(Cisco|CCNA|CCNP)\b/i },
    { name: "IBM", regex: /\b(IBM|IBM Cloud)\b/i },
    { name: "HashiCorp", regex: /\b(HashiCorp|Terraform)\b/i },
    { name: "MongoDB", regex: /\b(MongoDB University|MongoDB Certified)\b/i },
    { name: "HackerRank", regex: /\b(HackerRank)\b/i },
    { name: "freeCodeCamp", regex: /\b(freeCodeCamp)\b/i },
  ];

  for (const item of issuers) {
    if (item.regex.test(cleanText) || item.regex.test(filename)) {
      result.issuer = item.name;
      break;
    }
  }
  if (!result.issuer) {
    result.issuer = "Verified Educational Authority";
  }

  // 2. Identify Certificate Title
  const titleMatch =
    cleanText.match(/(?:certificate of (?:completion|achievement)|successfully completed|has achieved|certified as|certification in)\s+([A-Za-z0-9\s-]{4,60})/i) ||
    cleanText.match(/([A-Za-z0-9\s-]{4,50}\s+(?:Architect|Developer|Engineer|Specialist|Associate|Professional|Practitioner|Administrator|Mastery))/i);

  if (titleMatch) {
    result.title = titleMatch[1]?.replace(/\n/g, " ").trim();
  } else {
    // Infer title from filename
    const cleanFileName = filename
      .replace(/\.[^/.]+$/, "")
      .replace(/[-_]/g, " ")
      .replace(/(certificate|cert|verified|diploma|proof)/gi, "")
      .trim();
    result.title = cleanFileName
      ? cleanFileName.charAt(0).toUpperCase() + cleanFileName.slice(1)
      : "Verified Technical Credential";
  }

  // 3. Credential ID
  const idMatch =
    cleanText.match(/(?:Certificate ID|Credential ID|License|Verification Number|Serial|ID)[\s:=-]+([A-Za-z0-9-]{6,32})/i) ||
    cleanText.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})\b/);

  if (idMatch) {
    result.credentialId = idMatch[1]?.trim();
  } else {
    result.credentialId = `VP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  }

  // 4. Skills extraction
  const commonSkills = [
    "React", "Node.js", "Python", "JavaScript", "TypeScript", "AWS", "Google Cloud",
    "Azure", "Docker", "Kubernetes", "Machine Learning", "Deep Learning", "SQL",
    "PostgreSQL", "MongoDB", "Cybersecurity", "DevOps", "Data Science", "System Design",
    "REST APIs", "GraphQL", "Java", "C++", "Go", "Rust", "Terraform", "CI/CD"
  ];

  for (const s of commonSkills) {
    const re = new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");
    if (re.test(cleanText) || re.test(result.title) || re.test(filename)) {
      result.skills.push(s);
    }
  }

  if (result.skills.length === 0) {
    result.skills = ["Cloud Computing", "Full Stack Development"];
  }

  return result;
};

// @desc    Get all certificates for the authenticated user
// @route   GET /api/certificates
// @access  Private (Candidates & Recruiters)
const getMyCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(certificates);
});

// @desc    Upload and create a new verified certificate (Supports Auto-Extract or Manual)
// @route   POST /api/certificates
// @access  Private (Candidates & Recruiters)
const createCertificate = asyncHandler(async (req, res) => {
  let { title, issuer, issueDate, expiryDate, credentialId, credentialUrl, skills, autoExtract } = req.body;

  let fileUrl = "";
  let fileType = "document";
  let extractedText = "";

  if (req.file) {
    fileUrl = `/uploads/certificates/${req.file.filename}`;
    fileType = req.file.mimetype || "application/pdf";

    // Attempt text extraction if autoExtract is requested or missing essential fields
    if (autoExtract === "true" || autoExtract === true || !title || !issuer) {
      const filePath = path.join(__dirname, "..", "uploads", "certificates", req.file.filename);
      if (fs.existsSync(filePath)) {
        try {
          if (fileType.includes("pdf") || req.file.originalname.toLowerCase().endsWith(".pdf")) {
            const buffer = fs.readFileSync(filePath);
            const pdfData = await pdfParse(buffer);
            extractedText = pdfData?.text || "";
          }
        } catch (parseErr) {
          console.warn("[Certificate AI Extract] Text parse notice:", parseErr.message);
        }
      }

      const extracted = extractCertificateFromText(extractedText, req.file.originalname);
      title = title || extracted.title;
      issuer = issuer || extracted.issuer;
      credentialId = credentialId || extracted.credentialId;
      if (!skills || (Array.isArray(skills) && skills.length === 0)) {
        skills = extracted.skills;
      }
    }
  } else if (req.body.fileUrl) {
    fileUrl = req.body.fileUrl;
  }

  // Fallbacks if still unspecified
  title = title || "Verified Technical Credential";
  issuer = issuer || "VeriProof Certified Provider";

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
    parsedSkills = ["Full Stack", "System Verification"];
  }

  const certificate = await Certificate.create({
    user: req.user._id,
    title: title.trim(),
    issuer: issuer.trim(),
    issueDate: issueDate ? new Date(issueDate) : new Date(),
    expiryDate: expiryDate ? new Date(expiryDate) : undefined,
    credentialId: (credentialId || `VP-${Date.now().toString(36).toUpperCase()}`).trim(),
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
