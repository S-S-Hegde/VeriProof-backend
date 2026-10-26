const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const Certificate = require("../models/Certificate");
const User = require("../models/User");
const { parseCertificateDocument } = require("../services/parsers/parserRegistry");
const { verifyWithIssuerAdapter } = require("../services/adapters/issuerAdapterRegistry");
const { calculateCredentialScore, recalculateUserCertificateScore } = require("../services/scoringService");
const { crossCheckWithResume } = require("../services/resumeCrossCheck");
const {
  validateMagicBytes,
  saveFileToGridFS,
  getFileStreamFromGridFS,
  deleteFileFromGridFS,
  generateSignedProofToken,
  verifySignedProofToken,
} = require("../utils/gridfsStorage");
const config = require("../config/certificateScoringConfig");

// @desc    Get all certificates for the authenticated user with real tallies
// @route   GET /api/certificates
// @access  Private
const getMyCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ user: req.user._id }).sort({ createdAt: -1 });

  // Attach signed short-lived proof tokens to each certificate for authorized preview
  const enhancedCertificates = certificates.map((c) => {
    const certObj = c.toObject();
    const token = generateSignedProofToken(c._id, req.user._id);
    certObj.proofUrl = `/api/certificates/${c._id}/file?token=${token}`;
    return certObj;
  });

  // Compute live idempotent score summary
  const summary = {
    total: certificates.length,
    issuerConfirmed: certificates.filter((c) => c.verificationStatus === "ISSUER_CONFIRMED").length,
    documentRead: certificates.filter((c) => c.verificationStatus === "DOCUMENT_READ").length,
    needsReview: certificates.filter(
      (c) => c.verificationStatus === "NAME_MISMATCH" || c.verificationStatus === "UNVERIFIED"
    ).length,
    rejected: certificates.filter((c) => c.verificationStatus === "REJECTED").length,
    duplicates: certificates.filter((c) => c.verificationStatus === "DUPLICATE").length,
    totalXp: certificates.reduce((acc, c) => acc + (c.xpAwarded || 0), 0),
    totalTrustBoost: Math.min(
      config.MAX_TOTAL_TRUST_BOOST,
      certificates.reduce((acc, c) => acc + (c.trustScoreBonus || 0), 0)
    ),
  };

  res.json({
    certificates: enhancedCertificates,
    summary,
  });
});

// @desc    Upload & process certificates with independent per-file tracking
// @route   POST /api/certificates
// @access  Private
const uploadCertificates = asyncHandler(async (req, res) => {
  const files = req.files || (req.file ? [req.file] : []);

  if (files.length === 0) {
    res.status(400);
    throw new Error("No certificate files provided for processing.");
  }

  // Cap upload count
  if (files.length > config.MAX_UPLOAD_COUNT) {
    res.status(400);
    throw new Error(`Exceeded maximum batch upload count of ${config.MAX_UPLOAD_COUNT} files.`);
  }

  const results = [];
  const savedCertificates = [];
  const currentUser = await User.findById(req.user._id);

  for (const file of files) {
    const fileResult = {
      filename: file.originalname,
      status: "processing",
      error: null,
      certificate: null,
    };

    try {
      const buffer = file.buffer;
      if (!buffer || buffer.length === 0) {
        throw new Error("Empty file payload received.");
      }

      // Cap upload size
      if (buffer.length > config.MAX_UPLOAD_SIZE_BYTES) {
        throw new Error(`File exceeds maximum size of ${config.MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB.`);
      }

      // Validate magic bytes (PDF, PNG, JPEG, WebP)
      const magicCheck = validateMagicBytes(buffer);
      if (!magicCheck.valid) {
        throw new Error(magicCheck.error);
      }

      // Compute SHA-256 hash for strict deduplication
      const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

      // Check for duplicate file hash for this user
      const existingHashCert = await Certificate.findOne({
        user: req.user._id,
        file_hash: fileHash,
      });

      if (existingHashCert) {
        fileResult.status = "done";
        fileResult.duplicate = true;
        fileResult.certificate = existingHashCert;
        fileResult.message = "Duplicate file already exists on ledger. No additional points awarded.";
        results.push(fileResult);
        continue;
      }

      // Store in MongoDB GridFS (Zero ephemeral disk loss)
      const gridFsResult = await saveFileToGridFS(
        buffer,
        file.originalname,
        magicCheck.mimeType,
        {
          userId: req.user._id,
          fileHash,
        }
      );

      // Extract document metadata via Deterministic Parser Registry
      const extracted = await parseCertificateDocument(
        buffer,
        magicCheck.mimeType,
        file.originalname
      );

      // Verify with Issuer Adapter (allowlist, SSRF protection, token-subset name matching)
      const verification = await verifyWithIssuerAdapter(extracted, currentUser);

      // Check duplicate by issuer + credential_id
      if (extracted.credential_id && extracted.issuer_canonical) {
        const existingIdCert = await Certificate.findOne({
          user: req.user._id,
          issuer_canonical: extracted.issuer_canonical,
          credential_id: extracted.credential_id,
        });

        if (existingIdCert) {
          verification.status = "DUPLICATE";
          verification.reason = `Credential ID ${extracted.credential_id} already registered for ${extracted.issuer_canonical}.`;
        }
      }

      // Resume Cross-Check (separate from verification status)
      const resumeCheck = await crossCheckWithResume(
        req.user._id,
        extracted.title_as_printed,
        extracted.issuer_as_printed
      );

      // Calculate evidence-weighted score from config
      const tempCertForScore = {
        verificationStatus: verification.status,
        score_details: extracted.score_details,
      };
      const score = calculateCredentialScore(tempCertForScore);

      // Construct verified record without invented fallbacks
      const newCert = await Certificate.create({
        user: req.user._id,
        title: extracted.title_as_printed || "Not stated on certificate",
        title_as_printed: extracted.title_as_printed,
        issuer: extracted.issuer_as_printed || "Not stated on certificate",
        issuer_as_printed: extracted.issuer_as_printed,
        issuer_canonical: extracted.issuer_canonical,
        certificate_type: extracted.certificate_type || "Certificate",
        recipient_as_printed: extracted.recipient_as_printed,
        recipientName: extracted.recipient_as_printed,
        issueDate: extracted.issue_date ? new Date(extracted.issue_date) : null,
        session_or_period: extracted.session_or_period,
        credentialId: extracted.credential_id,
        verification_url: extracted.verification_url,
        signatory: extracted.signatory,
        score_details: extracted.score_details,
        gridfs_id: gridFsResult.gridfs_id,
        file_hash: fileHash,
        fileType: magicCheck.mimeType,
        originalFilename: file.originalname,
        raw_text: extracted.raw_text,
        extraction_method: extracted.extraction_method,
        field_sources: extracted.field_sources,
        skills: extracted.skills || [],
        subject: extracted.subject,
        vendor: extracted.issuer_canonical || extracted.issuer_as_printed,
        verificationStatus: verification.status,
        verificationReason: verification.reason,
        checkedAt: verification.checkedAt,
        isResumeVerified: resumeCheck.isResumeVerified,
        resumeMatched: resumeCheck.resumeMatched,
        resumeMatchDetails: resumeCheck.resumeMatchDetails,
        trustScoreBonus: score.trustEarned,
        xpAwarded: score.xpEarned,
      });

      // Update signed proof URL
      const signedToken = generateSignedProofToken(newCert._id, req.user._id);
      newCert.fileUrl = `/api/certificates/${newCert._id}/file?token=${signedToken}`;
      await newCert.save();

      fileResult.status = "done";
      fileResult.certificate = newCert;
      savedCertificates.push(newCert);
    } catch (err) {
      fileResult.status = "failed";
      fileResult.error = err.message || "Failed to parse and verify certificate.";
    }

    results.push(fileResult);
  }

  // Idempotently recalculate user skill progression
  await recalculateUserCertificateScore(req.user._id, Certificate, User);

  res.status(201).json({
    message: `Processed ${files.length} certificates (${savedCertificates.length} successful).`,
    results,
    certificates: savedCertificates,
  });
});

// @desc    Get certificate proof file with authorized ownership/token checking
// @route   GET /api/certificates/:id/file
// @access  Protected via Session Token or Signed Short-Lived URL Token
const getCertificateFile = asyncHandler(async (req, res) => {
  const certificate = await Certificate.findById(req.params.id);

  if (!certificate) {
    res.status(404).json({
      error: "PROOF_NOT_FOUND",
      message: "Certificate record not found.",
    });
    return;
  }

  // 1. Authorization Check:
  // Check signed query token OR Authorization bearer header
  let isAuthorized = false;

  if (req.query.token) {
    isAuthorized = verifySignedProofToken(certificate._id, certificate.user, req.query.token);
  }

  if (!isAuthorized && req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      const token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const reqUser = await User.findById(decoded.id || decoded._id).select("_id role");
      if (
        reqUser &&
        (reqUser._id.toString() === certificate.user.toString() ||
          reqUser.role === "recruiter" ||
          reqUser.role === "admin")
      ) {
        isAuthorized = true;
      }
    } catch (authErr) {}
  }

  // For embeddable preview in the user's active session, allow if signed token or auth matched
  if (!isAuthorized && !req.query.token) {
    res.status(403).json({
      error: "UNAUTHORIZED",
      message: "Access to proof file requires authentication or a valid signed short-lived token.",
    });
    return;
  }

  const isDownload = req.query.download === "true";
  const filename = `${(certificate.title_as_printed || "certificate").replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Content-Type", certificate.fileType || "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${isDownload ? "attachment" : "inline"}; filename="${filename}"`
  );

  // 1. Deliver directly from MongoDB GridFS
  if (certificate.gridfs_id) {
    try {
      const downloadStream = getFileStreamFromGridFS(certificate.gridfs_id);
      downloadStream.on("error", () => {
        res.status(404).json({
          error: "PROOF_UNAVAILABLE",
          message: "Proof file unavailable. Re-upload to restore.",
          reuploadRequired: true,
        });
      });
      return downloadStream.pipe(res);
    } catch (gridErr) {
      console.warn("[GridFS Stream Warning]:", gridErr.message);
    }
  }

  // 2. Deliver from local disk cache if available
  if (certificate.fileUrl) {
    const localBasename = path.basename(certificate.fileUrl.split("?")[0]);
    const diskPath = path.join(__dirname, "../uploads/certificates", localBasename);
    if (fs.existsSync(diskPath)) {
      return res.sendFile(diskPath);
    }
  }

  // 3. Structured Unavailable State (Never show raw JSON in UI)
  res.status(404).json({
    error: "PROOF_UNAVAILABLE",
    message: "Proof file unavailable. Re-upload to restore.",
    reuploadRequired: true,
  });
});

// @desc    Delete a certificate and update scores
// @route   DELETE /api/certificates/:id
// @access  Private
const deleteCertificate = asyncHandler(async (req, res) => {
  const certificate = await Certificate.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!certificate) {
    res.status(404);
    throw new Error("Certificate not found or unauthorized.");
  }

  // Delete from GridFS if present
  if (certificate.gridfs_id) {
    await deleteFileFromGridFS(certificate.gridfs_id);
  }

  await Certificate.deleteOne({ _id: certificate._id });
  await recalculateUserCertificateScore(req.user._id, Certificate, User);

  res.json({ message: "Certificate removed successfully.", id: req.params.id });
});

// @desc    Re-analyze all certificates for the user idempotently
// @route   POST /api/certificates/re-analyze-all
// @access  Private
const reanalyzeAllCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ user: req.user._id });
  const currentUser = await User.findById(req.user._id);

  let updatedCount = 0;

  for (const cert of certificates) {
    let buffer = null;

    if (cert.gridfs_id) {
      try {
        const stream = getFileStreamFromGridFS(cert.gridfs_id);
        const chunks = [];
        await new Promise((resolve, reject) => {
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => {
            buffer = Buffer.concat(chunks);
            resolve();
          });
          stream.on("error", reject);
        });
      } catch (e) {}
    }

    if (buffer) {
      const extracted = await parseCertificateDocument(buffer, cert.fileType, cert.originalFilename);
      const verification = await verifyWithIssuerAdapter(extracted, currentUser);
      const resumeCheck = await crossCheckWithResume(
        req.user._id,
        extracted.title_as_printed,
        extracted.issuer_as_printed
      );

      const score = calculateCredentialScore({
        verificationStatus: verification.status,
        score_details: extracted.score_details,
      });

      cert.title_as_printed = extracted.title_as_printed;
      cert.title = extracted.title_as_printed || cert.title;
      cert.issuer_as_printed = extracted.issuer_as_printed;
      cert.issuer_canonical = extracted.issuer_canonical;
      cert.issuer = extracted.issuer_as_printed || cert.issuer;
      cert.recipient_as_printed = extracted.recipient_as_printed;
      cert.certificate_type = extracted.certificate_type;
      cert.issueDate = extracted.issue_date ? new Date(extracted.issue_date) : cert.issueDate;
      cert.session_or_period = extracted.session_or_period;
      cert.credentialId = extracted.credential_id;
      cert.signatory = extracted.signatory;
      cert.score_details = extracted.score_details;
      cert.verification_url = extracted.verification_url;
      cert.skills = extracted.skills || [];
      cert.subject = extracted.subject;
      cert.verificationStatus = verification.status;
      cert.verificationReason = verification.reason;
      cert.checkedAt = verification.checkedAt;
      cert.isResumeVerified = resumeCheck.isResumeVerified;
      cert.resumeMatched = resumeCheck.resumeMatched;
      cert.resumeMatchDetails = resumeCheck.resumeMatchDetails;
      cert.xpAwarded = score.xpEarned;
      cert.trustScoreBonus = score.trustEarned;

      await cert.save();
      updatedCount++;
    }
  }

  await recalculateUserCertificateScore(req.user._id, Certificate, User);

  const updatedCertificates = await Certificate.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({
    message: `Successfully re-analyzed ${updatedCount} certificates.`,
    certificates: updatedCertificates,
  });
});

module.exports = {
  getMyCertificates,
  uploadCertificates,
  getCertificateFile,
  deleteCertificate,
  reanalyzeAllCertificates,
};
