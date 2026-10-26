/**
 * Configurable Certificate Scoring Weights & Verification Rules
 */
const certificateScoringConfig = {
  // Base XP allocations
  PROCTORED_EXAM_BASE_XP: 300,
  COMPLETION_CERT_BASE_XP: 100,

  // Verification status XP multipliers
  STATUS_MULTIPLIERS: {
    ISSUER_CONFIRMED: 1.0,    // 100% of base XP
    DOCUMENT_READ: 0.25,      // 25% of base XP (reduced for document-read proof pending issuer API)
    UNVERIFIED: 0.0,
    NAME_MISMATCH: 0.0,
    REJECTED: 0.0,
    DUPLICATE: 0.0,
  },

  // Trust score points per credential
  TRUST_POINTS: {
    ISSUER_CONFIRMED: 10,
    DOCUMENT_READ: 3,
    UNVERIFIED: 0,
    NAME_MISMATCH: 0,
    REJECTED: 0,
    DUPLICATE: 0,
  },

  // Cap total trust boost from all certificates combined
  MAX_TOTAL_TRUST_BOOST: 25,

  // Magic bytes mapping for strict document integrity validation
  ALLOWED_MAGIC_BYTES: [
    { type: "application/pdf", ext: ".pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
    { type: "image/png", ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47] },       // PNG
    { type: "image/jpeg", ext: ".jpg", magic: [0xff, 0xd8, 0xff] },            // JPEG
    { type: "image/webp", ext: ".webp", magic: [0x52, 0x49, 0x46, 0x46] },      // RIFF (WebP)
  ],

  // Max upload limits
  MAX_UPLOAD_SIZE_BYTES: 15 * 1024 * 1024, // 15MB
  MAX_UPLOAD_COUNT: 10,
};

module.exports = certificateScoringConfig;
