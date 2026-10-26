/**
 * Evidence-Based Certificate Scoring Configuration
 * Weights keyed on document features and verification status.
 */
const certificateScoringConfig = {
  // Document Type Base XP
  BASE_XP: {
    degree_or_diploma: 400,
    exam_or_license: 300,
    professional_certification: 250,
    program_completion: 150,
    course_completion: 100,
    badge: 50,
    workshop_or_participation: 50,
    internship_or_employment: 150,
    award: 100,
    other: 50,
  },

  // Base trust points per document type
  BASE_TRUST_POINTS: {
    degree_or_diploma: 15,
    exam_or_license: 12,
    professional_certification: 10,
    program_completion: 6,
    course_completion: 4,
    badge: 2,
    workshop_or_participation: 2,
    internship_or_employment: 6,
    award: 4,
    other: 2,
  },

  // Bonus XP if proctored/exam score is confirmed
  PROCTORED_EXAM_BONUS_XP: 100,

  // Status Multipliers
  STATUS_MULTIPLIERS: {
    ISSUER_CONFIRMED: 1.0,
    MANUALLY_CONFIRMED: 0.75,
    DOCUMENT_READ: 0.25,
    UNVERIFIED: 0.0,
    NAME_MISMATCH: 0.0,
    REJECTED: 0.0,
    DUPLICATE: 0.0,
  },

  // Hard cap on total trust boost awarded from all certificates combined
  MAX_TOTAL_TRUST_BOOST: 25,

  // Legacy aliases
  PROCTORED_EXAM_BASE_XP: 300,
  COMPLETION_CERT_BASE_XP: 100,
  TRUST_POINTS: {
    ISSUER_CONFIRMED: 10,
    DOCUMENT_READ: 3,
    UNVERIFIED: 0,
    NAME_MISMATCH: 0,
    REJECTED: 0,
    DUPLICATE: 0,
  },

  ALLOWED_MAGIC_BYTES: [
    { type: "application/pdf", ext: ".pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
    { type: "image/png", ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47] },       // PNG
    { type: "image/jpeg", ext: ".jpg", magic: [0xff, 0xd8, 0xff] },            // JPEG
    { type: "image/webp", ext: ".webp", magic: [0x52, 0x49, 0x46, 0x46] },      // RIFF
  ],

  MAX_UPLOAD_SIZE_BYTES: 15 * 1024 * 1024, // 15MB
  MAX_UPLOAD_COUNT: 10,
};

module.exports = certificateScoringConfig;
