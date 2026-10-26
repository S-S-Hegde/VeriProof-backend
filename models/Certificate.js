const mongoose = require("mongoose");

const certificateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Printed & canonical metadata
    title: {
      type: String,
      required: true,
      trim: true,
    },
    title_as_printed: {
      type: String,
      trim: true,
      default: null,
    },
    issuer: {
      type: String,
      required: true,
      trim: true,
    },
    issuer_as_printed: {
      type: String,
      trim: true,
      default: null,
    },
    issuer_canonical: {
      type: String,
      trim: true,
      default: null,
    },
    certificate_type: {
      type: String,
      trim: true,
      default: "Certificate",
    },
    recipient_as_printed: {
      type: String,
      trim: true,
      default: null,
    },
    recipientName: {
      type: String,
      trim: true,
      default: null,
    },
    // Dates
    issueDate: {
      type: Date,
      default: null, // Never default to upload date!
    },
    uploaded_at: {
      type: Date,
      default: Date.now,
    },
    session_or_period: {
      type: String,
      trim: true,
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    // Identifiers & URLs
    credentialId: {
      type: String,
      trim: true,
      default: null,
    },
    credentialUrl: {
      type: String,
      trim: true,
      default: null,
    },
    verification_url: {
      type: String,
      trim: true,
      default: null,
    },
    signatory: {
      type: String,
      trim: true,
      default: null,
    },
    // Scores & details (NPTEL, proctored exams)
    score_details: {
      consolidated_score: { type: String, default: null },
      online_assignments: { type: String, default: null },
      proctored_exam: { type: String, default: null },
      candidates_certified: { type: Number, default: null },
      credits_recommended: { type: String, default: null },
      elite_badge: { type: Boolean, default: false },
    },
    // File storage & hashing (GridFS & Cloudinary)
    gridfs_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    cloudinary_public_id: {
      type: String,
      default: null,
    },
    file_hash: {
      type: String,
      trim: true,
      index: true,
      default: null,
    },
    fileUrl: {
      type: String,
      default: "",
    },
    fileType: {
      type: String,
      default: "application/pdf",
    },
    originalFilename: {
      type: String,
      default: "",
    },
    // Method & Provenance
    raw_text: {
      type: String,
      default: "",
    },
    extraction_method: {
      type: String,
      enum: ["template", "ocr_llm", "manual"],
      default: "template",
    },
    field_sources: {
      type: Map,
      of: String,
      default: () => new Map(),
    },
    // Skills (derived strictly from title keywords, never invented)
    skills: {
      type: [String],
      default: [],
    },
    subject: {
      type: String,
      default: null,
      trim: true,
    },
    vendor: {
      type: String,
      default: null,
      trim: true,
    },
    // Verification state (Section 4 Truthful State Machine)
    verificationStatus: {
      type: String,
      enum: [
        "ISSUER_CONFIRMED",
        "DOCUMENT_READ",
        "UNVERIFIED",
        "NAME_MISMATCH",
        "REJECTED",
        "DUPLICATE",
      ],
      default: "UNVERIFIED",
    },
    verificationReason: {
      type: String,
      default: "Extraction completed, verification pending.",
    },
    checkedAt: {
      type: Date,
      default: Date.now,
    },
    // Separate Resume Cross-Check (Section 8: Never mixed with verification status)
    isResumeVerified: {
      type: Boolean,
      default: false,
      index: true,
    },
    resumeMatched: {
      type: Boolean,
      default: false,
    },
    resumeMatchDetails: {
      type: String,
      default: "Not in resume",
    },
    // Scoring (calculated from evidence, not flat free points)
    trustScoreBonus: {
      type: Number,
      default: 0,
    },
    xpAwarded: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Certificate", certificateSchema);
