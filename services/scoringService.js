const config = require("../config/certificateScoringConfig");

/**
 * Evidence-Based Certificate Scoring Engine
 * Truthful, idempotent XP and Trust Score calculation with configurable weights & caps.
 */

/**
 * Calculates XP and Trust Bonus for a single credential record
 */
function calculateCredentialScore(credential) {
  const status = credential.verificationStatus || "UNVERIFIED";
  const multiplier = config.STATUS_MULTIPLIERS[status] ?? 0;

  // Determine if credential involved a proctored exam or score
  const isProctored = Boolean(
    credential.score_details?.proctored_exam ||
    credential.score_details?.consolidated_score
  );

  const baseXP = isProctored
    ? config.PROCTORED_EXAM_BASE_XP
    : config.COMPLETION_CERT_BASE_XP;

  const xpEarned = Math.round(baseXP * multiplier);
  const trustEarned = config.TRUST_POINTS[status] ?? 0;

  let reason = "No points awarded.";
  if (status === "ISSUER_CONFIRMED") {
    reason = isProctored
      ? `Full XP awarded for confirmed proctored exam (${xpEarned} XP)`
      : `Full XP awarded for confirmed completion credential (${xpEarned} XP)`;
  } else if (status === "DOCUMENT_READ") {
    reason = `Reduced XP awarded (25% weight) for document-read proof pending issuer API (${xpEarned} XP)`;
  } else if (status === "NAME_MISMATCH") {
    reason = "0 XP: Recipient name differs from account holder.";
  } else if (status === "DUPLICATE") {
    reason = "0 XP: Duplicate certificate upload.";
  }

  return {
    xpEarned,
    trustEarned,
    reason,
  };
}

/**
 * Idempotently recalculates total XP and Trust for a user from their active stored certificates
 */
async function recalculateUserCertificateScore(userId, CertificateModel, UserModel) {
  if (!userId) return null;

  const certificates = await CertificateModel.find({
    user: userId,
    verificationStatus: { $ne: "DUPLICATE" },
  });

  let totalXp = 0;
  let rawTrust = 0;
  let confirmedCount = 0;
  let readCount = 0;

  for (const cert of certificates) {
    const score = calculateCredentialScore(cert);
    totalXp += score.xpEarned;
    rawTrust += score.trustEarned;
    if (cert.verificationStatus === "ISSUER_CONFIRMED") confirmedCount++;
    if (cert.verificationStatus === "DOCUMENT_READ") readCount++;
  }

  // Cap total trust boost from certificates according to config
  const totalTrust = Math.min(config.MAX_TOTAL_TRUST_BOOST, rawTrust);

  if (UserModel) {
    const user = await UserModel.findById(userId);
    if (user && user.skillProgress) {
      user.skillProgress.verifiedCount = confirmedCount;
      await user.save();
    }
  }

  return {
    totalXp,
    totalTrust,
    rawTrust,
    confirmedCount,
    readCount,
  };
}

module.exports = {
  SCORING_CONFIG: config,
  calculateCredentialScore,
  recalculateUserCertificateScore,
};
