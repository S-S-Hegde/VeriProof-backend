const mongoose = require("mongoose");

const fieldProofSchema = new mongoose.Schema(
  {
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    evidence_quote: { type: String, default: null },
    source: {
      type: String,
      enum: ["text", "ocr", "qr", "issuer_page", "user_corrected", "derived"],
      default: "text",
    },
    confidence: { type: Number, default: 0 },
  },
  { _id: false }
);

const certificateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Universal Core Fields
    document_type: {
      value: {
        type: String,
        enum: [
          "course_completion",
          "program_completion",
          "professional_certification",
          "exam_or_license",
          "degree_or_diploma",
          "badge",
          "workshop_or_participation",
          "internship_or_employment",
          "award",
          "other",
          null,
        ],
        default: "other",
      },
      evidence_quote: { type: String, default: null },
      source: { type: String, default: "text" },
      confidence: { type: Number, default: 0 },
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    title_field: { type: fieldProofSchema, default: () => ({}) },
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
    recipient_name: {
      type: String,
      trim: true,
      default: null,
    },
    recipient_field: { type: fieldProofSchema, default: () => ({}) },
    // Dates
    issueDate: {
      type: Date,
      default: null,
    },
    issue_date_field: { type: fieldProofSchema, default: () => ({}) },
    expiryDate: {
      type: Date,
      default: null,
    },
    period_or_session: {
      type: String,
      trim: true,
      default: null,
    },
    duration_hours: {
      type: String,
      trim: true,
      default: null,
    },
    credits: {
      type: String,
      trim: true,
      default: null,
    },
    grade_or_level: {
      type: String,
      trim: true,
      default: null,
    },
    // Arrays for universal extraction
    identifiers: [
      {
        label_as_printed: { type: String, default: "Identifier" },
        value: { type: String, required: true },
        evidence_quote: { type: String, default: null },
        source: { type: String, default: "text" },
        confidence: { type: Number, default: 0 },
      },
    ],
    scores: [
      {
        label_as_printed: { type: String, default: "Score" },
        value: { type: String, required: true },
        max: { type: String, default: null },
        unit: { type: String, default: null },
        evidence_quote: { type: String, default: null },
        source: { type: String, default: "text" },
        confidence: { type: Number, default: 0 },
      },
    ],
    signatories: [
      {
        name: { type: String, required: true },
        role: { type: String, default: null },
        organisation: { type: String, default: null },
        evidence_quote: { type: String, default: null },
        source: { type: String, default: "text" },
        confidence: { type: Number, default: 0 },
      },
    ],
    verification_urls: [
      {
        url: { type: String, required: true },
        source: { type: String, enum: ["qr", "text"], default: "text" },
        confidence: { type: Number, default: 1 },
      },
    ],
    qr_payloads: [
      {
        raw: { type: String, required: true },
        kind: {
          type: String,
          enum: ["url", "w3c_vc", "open_badge", "jwt", "text", "json"],
          default: "text",
        },
      },
    ],
    extras: [
      {
        label_as_printed: { type: String, default: "Detail" },
        value: { type: String, required: true },
        evidence_quote: { type: String, default: null },
        source: { type: String, default: "text" },
        confidence: { type: Number, default: 0 },
      },
    ],
    // Provenance & Quality
    language: { type: String, default: "en" },
    page_count: { type: Number, default: 1 },
    pdf_metadata: {
      producer: { type: String, default: null },
      creator: { type: String, default: null },
      created: { type: String, default: null },
      modified: { type: String, default: null },
    },
    extraction_method: {
      type: String,
      enum: ["text", "ocr", "text+ocr", "fallback", "template"],
      default: "text",
    },
    extraction_confidence: { type: Number, default: 1.0 },
    raw_text: { type: String, default: "" },
    file_hash: { type: String, trim: true, index: true, default: null },
    ungrounded_fields: { type: [String], default: [] },

    // Storage: GridFS and Cloudinary
    gridfs_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    cloudinary_public_id: { type: String, default: null },
    fileUrl: { type: String, default: "" },
    fileType: { type: String, default: "application/pdf" },
    originalFilename: { type: String, default: "" },
    uploaded_at: { type: Date, default: Date.now },

    // Skills
    skills: { type: [String], default: [] },

    // Truthful Verification Status
    verificationStatus: {
      type: String,
      enum: [
        "ISSUER_CONFIRMED",
        "MANUALLY_CONFIRMED",
        "DOCUMENT_READ",
        "UNVERIFIED",
        "NAME_MISMATCH",
        "REJECTED",
        "DUPLICATE",
      ],
      default: "UNVERIFIED",
      index: true,
    },
    verificationReason: {
      type: String,
      default: "Extraction completed, verification pending.",
    },
    checkedAt: { type: Date, default: Date.now },
    verification_audit: [
      {
        time: { type: Date, default: Date.now },
        strategy: { type: String, required: true },
        host: { type: String, default: "local" },
        result: { type: String, required: true },
        reason: { type: String, default: "" },
        actor: { type: String, default: "system" },
      },
    ],

    // User edits audit trail
    user_edits: [
      {
        field: { type: String, required: true },
        original_value: { type: mongoose.Schema.Types.Mixed },
        new_value: { type: mongoose.Schema.Types.Mixed },
        edited_at: { type: Date, default: Date.now },
      },
    ],

    // Resume cross-check
    isResumeVerified: { type: Boolean, default: false, index: true },
    resumeMatched: { type: Boolean, default: false },
    resumeMatchDetails: { type: String, default: "Not in resume" },

    // Scoring
    trustScoreBonus: { type: Number, default: 0 },
    xpAwarded: { type: Number, default: 0 },

    // Legacy backwards compatibility aliases
    credentialId: { type: String, default: null },
    credentialUrl: { type: String, default: null },
    verification_url: { type: String, default: null },
    signatory: { type: String, default: null },
    score_details: {
      consolidated_score: { type: String, default: null },
      online_assignments: { type: String, default: null },
      proctored_exam: { type: String, default: null },
      candidates_certified: { type: Number, default: null },
      credits_recommended: { type: String, default: null },
      elite_badge: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Certificate", certificateSchema);
