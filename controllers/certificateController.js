const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const Certificate = require("../models/Certificate");
const User = require("../models/User");
const { parseCertificateDocument } = require("../services/parsers/parserRegistry");
const { verifyWithIssuerAdapter } = require("../services/adapters/issuerAdapterRegistry");
const { calculateCredentialScore, recalculateUserCertificateScore } = require("../services/scoringService");
const { crossCheckWithResume } = require("../services/resumeCrossCheck");

// @desc    Get all certificates for the authenticated user with real tallies
// @route   GET /api/certificates
// @access  Private
const getMyCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ user: req.user._id }).sort({ createdAt: -1 });

  // Compute live idempotent score summary
  const summary = {
    total: certificates.length,
    issuerConfirmed: certificates.filter((c) => c.verificationStatus === "ISSUER_CONFIRMED").length,
    documentRead: certificates.filter((c) => c.verificationStatus === "DOCUMENT_READ").length,
    needsReview: certificates.filter((c) => c.verificationStatus === "NAME_MISMATCH" || c.verificationStatus === "UNVERIFIED").length,
    rejected: certificates.filter((c) => c.verificationStatus === "REJECTED").length,
    duplicates: certificates.filter((c) => c.verificationStatus === "DUPLICATE").length,
    totalXp: certificates.reduce((acc, c) => acc + (c.xpAwarded || 0), 0),
    totalTrustBoost: certificates.reduce((acc, c) => acc + (c.trustScoreBonus || 0), 0),
  };

  res.json({
    certificates,
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

      // Extract document metadata via Deterministic Parser Registry
      const extracted = await parseCertificateDocument(
        buffer,
        file.mimetype || "application/pdf",
        file.originalname
      );

      // Verify with Issuer Adapter (allowlist, SSRF protection, name comparison)
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

      // Save file buffer to local disk cache as backup
      const uploadDir = path.join(__dirname, "../uploads/certificates");
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const diskFilename = `cert_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.pdf`;
      const diskPath = path.join(uploadDir, diskFilename);
      try {
        fs.writeFileSync(diskPath, buffer);
      } catch (err) {}

      // Calculate evidence-weighted score
      const tempCertForScore = {
        verificationStatus: verification.status,
        score_details: extracted.score_details,
      };
      const score = calculateCredentialScore(tempCertForScore);

      // Construct verified record without invented fallbacks
      const newCert = await Certificate.create({
        user: req.user._id,
        title: extracted.title_as_printed || "Unspecified Certificate",
        title_as_printed: extracted.title_as_printed,
        issuer: extracted.issuer_as_printed || "Unspecified Authority",
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
        file_hash: fileHash,
        fileUrl: `/api/certificates/${diskFilename}`,
        fileType: file.mimetype || "application/pdf",
        fileBufferBase64: buffer.toString("base64"),
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

      // Update proper fileUrl pointing to permanent API file streaming route
      newCert.fileUrl = `/api/certificates/${newCert._id}/file`;
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

// @desc    Get certificate proof file with download support & structured errors
// @route   GET /api/certificates/:id/file
// @access  Public
const getCertificateFile = asyncHandler(async (req, res) => {
  const certificate = await Certificate.findById(req.params.id);

  if (!certificate) {
    res.status(404).json({
      error: "PROOF_NOT_FOUND",
      message: "Certificate record not found.",
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

  // 1. Deliver from database base64 buffer (bulletproof across Render restarts)
  if (certificate.fileBufferBase64) {
    const buffer = Buffer.from(certificate.fileBufferBase64, "base64");
    return res.send(buffer);
  }

  // 2. Deliver from local disk if available
  if (certificate.fileUrl) {
    const localBasename = path.basename(certificate.fileUrl);
    const diskPath = path.join(__dirname, "../uploads/certificates", localBasename);
    if (fs.existsSync(diskPath)) {
      return res.sendFile(diskPath);
    }
  }

  // 3. File unavailable state
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
    if (cert.fileBufferBase64) {
      try {
        buffer = Buffer.from(cert.fileBufferBase64, "base64");
      } catch (e) {}
    }

    if (buffer) {
      const extracted = await parseCertificateDocument(buffer, cert.fileType, cert.originalFilename);
      const verification = await verifyWithIssuerAdapter(extracted, currentUser);
      const resumeCheck = await crossCheckWithResume(req.user._id, extracted.title_as_printed, extracted.issuer_as_printed);

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
