const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const Certificate = require("../models/Certificate");
const User = require("../models/User");
const { extractUniversalCertificate } = require("../services/parsers/universalExtractor");
const { verifyUniversalCertificate } = require("../services/verification/universalVerifier");
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
    issuerConfirmed: certificates.filter(
      (c) => c.verificationStatus === "ISSUER_CONFIRMED" || c.verificationStatus === "MANUALLY_CONFIRMED"
    ).length,
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

      // Extract document metadata via Universal Extractor
      const extracted = await extractUniversalCertificate(
        buffer,
        magicCheck.mimeType,
        file.originalname
      );

      // Verify with Universal Verifier (S1-S4 strategies, token-subset name matching)
      const verification = await verifyUniversalCertificate(extracted, currentUser);

      // Check duplicate by issuer + credential_id
      const firstId = extracted.identifiers[0]?.value;
      if (firstId && extracted.issuer_canonical?.value) {
        const existingIdCert = await Certificate.findOne({
          user: req.user._id,
          issuer_canonical: extracted.issuer_canonical.value,
          credentialId: firstId,
        });

        if (existingIdCert) {
          verification.status = "DUPLICATE";
          verification.reason = `Credential ID ${firstId} already registered for ${extracted.issuer_canonical.value}.`;
        }
      }

      // Resume Cross-Check (separate from verification status)
      const resumeCheck = await crossCheckWithResume(
        req.user._id,
        extracted.title?.value,
        extracted.issuer_as_printed?.value
      );

      // Calculate evidence-weighted score from config
      const score = calculateCredentialScore({
        verificationStatus: verification.status,
        document_type: extracted.document_type,
        scores: extracted.scores,
        expiry_date: extracted.expiry_date,
      });

      // Construct verified record without invented fallbacks
      const newCert = await Certificate.create({
        user: req.user._id,
        document_type: extracted.document_type,
        title: extracted.title?.value || "Not stated on certificate",
        title_field: extracted.title,
        issuer: extracted.issuer_as_printed?.value || "Not stated on certificate",
        issuer_as_printed: extracted.issuer_as_printed?.value,
        issuer_canonical: extracted.issuer_canonical?.value,
        recipient_name: extracted.recipient_name?.value,
        recipient_field: extracted.recipient_name,
        issueDate: extracted.issue_date?.value ? new Date(extracted.issue_date.value) : null,
        issue_date_field: extracted.issue_date,
        expiryDate: extracted.expiry_date?.value ? new Date(extracted.expiry_date.value) : null,
        period_or_session: extracted.period_or_session?.value,
        duration_hours: extracted.duration_hours?.value,
        credits: extracted.credits?.value,
        grade_or_level: extracted.grade_or_level?.value,
        identifiers: extracted.identifiers || [],
        scores: extracted.scores || [],
        signatories: extracted.signatories || [],
        verification_urls: extracted.verification_urls || [],
        qr_payloads: extracted.qr_payloads || [],
        extras: extracted.extras || [],
        language: extracted.language || "en",
        page_count: extracted.page_count || 1,
        pdf_metadata: extracted.pdf_metadata || {},
        extraction_method: extracted.extraction_method || "text",
        extraction_confidence: extracted.extraction_confidence || 1.0,
        raw_text: extracted.raw_text || "",
        file_hash: fileHash,
        ungrounded_fields: extracted.ungrounded_fields || [],
        gridfs_id: gridFsResult.gridfs_id,
        fileType: magicCheck.mimeType,
        originalFilename: file.originalname,
        skills: extracted.skills || [],
        verificationStatus: verification.status,
        verificationReason: verification.reason,
        checkedAt: new Date(),
        verification_audit: verification.audit || [],
        isResumeVerified: resumeCheck.isResumeVerified,
        resumeMatched: resumeCheck.resumeMatched,
        resumeMatchDetails: resumeCheck.resumeMatchDetails,
        trustScoreBonus: score.trustEarned,
        xpAwarded: score.xpEarned,
        // Legacy fields for existing frontend compatibility
        credentialId: firstId || null,
        verification_url: extracted.verification_urls[0]?.url || null,
        signatory: extracted.signatories[0]?.name || null,
        score_details: {
          consolidated_score: extracted.scores.find((s) => s.unit === "%")?.value || null,
          online_assignments: extracted.scores.find((s) => s.label_as_printed?.toLowerCase().includes("assignment"))?.value || null,
          proctored_exam: extracted.scores.find((s) => s.label_as_printed?.toLowerCase().includes("exam"))?.value || null,
          candidates_certified: parseInt(extracted.extras.find((e) => e.label_as_printed?.toLowerCase().includes("candidates"))?.value || "0", 10) || null,
          credits_recommended: extracted.credits?.value || null,
          elite_badge: extracted.scores.some((s) => s.value === "Elite"),
        },
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

// @desc    Update certificate details ("Fix details" feature)
// @route   PUT /api/certificates/:id
// @access  Private
const updateCertificateDetails = asyncHandler(async (req, res) => {
  const certificate = await Certificate.findOne({
    _id: req.params.id,
    user: req.user._id,
  });

  if (!certificate) {
    res.status(404);
    throw new Error("Certificate not found or unauthorized.");
  }

  const { title, issuer, recipient_name, issueDate, credentialId } = req.body;
  const userEdits = certificate.user_edits || [];

  if (title && title !== certificate.title) {
    userEdits.push({ field: "title", original_value: certificate.title, new_value: title });
    certificate.title = title;
    certificate.title_field = { value: title, evidence_quote: title, source: "user_corrected", confidence: 1.0 };
  }
  if (issuer && issuer !== certificate.issuer) {
    userEdits.push({ field: "issuer", original_value: certificate.issuer, new_value: issuer });
    certificate.issuer = issuer;
    certificate.issuer_as_printed = issuer;
  }
  if (recipient_name && recipient_name !== certificate.recipient_name) {
    userEdits.push({ field: "recipient_name", original_value: certificate.recipient_name, new_value: recipient_name });
    certificate.recipient_name = recipient_name;
    certificate.recipient_field = { value: recipient_name, evidence_quote: recipient_name, source: "user_corrected", confidence: 1.0 };
  }
  if (issueDate) {
    const d = new Date(issueDate);
    userEdits.push({ field: "issueDate", original_value: certificate.issueDate, new_value: d });
    certificate.issueDate = d;
    certificate.issue_date_field = { value: issueDate, evidence_quote: issueDate, source: "user_corrected", confidence: 1.0 };
  }
  if (credentialId) {
    userEdits.push({ field: "credentialId", original_value: certificate.credentialId, new_value: credentialId });
    certificate.credentialId = credentialId;
    if (certificate.identifiers && certificate.identifiers.length > 0) {
      certificate.identifiers[0].value = credentialId;
      certificate.identifiers[0].source = "user_corrected";
    } else {
      certificate.identifiers = [{ label_as_printed: "Identifier", value: credentialId, source: "user_corrected", confidence: 1.0 }];
    }
  }

  certificate.user_edits = userEdits;
  // Any user edit resets verification status until re-verified
  certificate.verificationStatus = "DOCUMENT_READ";
  certificate.verificationReason = "Fields updated by user. Verification status reset to DOCUMENT_READ.";

  const score = calculateCredentialScore(certificate);
  certificate.xpAwarded = score.xpEarned;
  certificate.trustScoreBonus = score.trustEarned;

  await certificate.save();
  await recalculateUserCertificateScore(req.user._id, Certificate, User);

  res.json({
    message: "Certificate details updated successfully.",
    certificate,
  });
});

// @desc    Mark certificate as manually confirmed by recruiter
// @route   POST /api/certificates/:id/manual-confirm
// @access  Recruiter or Admin
const markManuallyConfirmed = asyncHandler(async (req, res) => {
  if (req.user.role !== "recruiter" && req.user.role !== "admin") {
    res.status(403);
    throw new Error("Only recruiters and administrators can manually confirm credentials.");
  }

  const certificate = await Certificate.findById(req.params.id);
  if (!certificate) {
    res.status(404);
    throw new Error("Certificate not found.");
  }

  certificate.verificationStatus = "MANUALLY_CONFIRMED";
  certificate.verificationReason = `Manually confirmed by ${req.user.email} (${req.body.reason || "Audited proof document"}).`;
  certificate.checkedAt = new Date();

  certificate.verification_audit.push({
    time: new Date(),
    strategy: "S4_MANUAL",
    host: "local",
    result: "MANUALLY_CONFIRMED",
    reason: req.body.reason || "Manual audit by recruiter",
    actor: req.user.email,
  });

  const score = calculateCredentialScore(certificate);
  certificate.xpAwarded = score.xpEarned;
  certificate.trustScoreBonus = score.trustEarned;

  await certificate.save();
  await recalculateUserCertificateScore(certificate.user, Certificate, User);

  res.json({
    message: "Certificate marked as manually confirmed.",
    certificate,
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

  // Authorization Check
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

  if (!isAuthorized && !req.query.token) {
    res.status(403).json({
      error: "UNAUTHORIZED",
      message: "Access to proof file requires authentication or a valid signed short-lived token.",
    });
    return;
  }

  const isDownload = req.query.download === "true";
  const filename = `${(certificate.title_as_printed || certificate.title || "certificate").replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Content-Type", certificate.fileType || "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${isDownload ? "attachment" : "inline"}; filename="${filename}"`
  );

  // Deliver directly from MongoDB GridFS
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

  // Deliver from local disk cache if available
  if (certificate.fileUrl) {
    const localBasename = path.basename(certificate.fileUrl.split("?")[0]);
    const diskPath = path.join(__dirname, "../uploads/certificates", localBasename);
    if (fs.existsSync(diskPath)) {
      return res.sendFile(diskPath);
    }
  }

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

  if (certificate.gridfs_id) {
    await deleteFileFromGridFS(certificate.gridfs_id);
  }

  await Certificate.deleteOne({ _id: certificate._id });
  await recalculateUserCertificateScore(req.user._id, Certificate, User);

  res.json({ message: "Certificate removed successfully.", id: req.params.id });
});

module.exports = {
  getMyCertificates,
  uploadCertificates,
  updateCertificateDetails,
  markManuallyConfirmed,
  getCertificateFile,
  deleteCertificate,
};
