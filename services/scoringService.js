const config = require("../config/certificateScoringConfig");

/**
 * Evidence-Based Certificate Scoring Engine.
 * Calculates XP and Trust based on verified evidence features.
 */
function calculateCredentialScore(credential) {
  const status = credential.verificationStatus || "UNVERIFIED";
  const multiplier = config.STATUS_MULTIPLIERS[status] ?? 0;

  // 1. Check expiration: expired credentials award 0
  const expiryDate = credential.expiry_date?.value || credential.expiry_date;
  if (expiryDate && new Date(expiryDate) < new Date()) {
    return {
      xpEarned: 0,
      trustEarned: 0,
      reason: "Expired credential: 0 points awarded.",
    };
  }

  // 2. Document type base XP
  const docType =
    credential.document_type?.value ||
    (credential.certificate_type?.toLowerCase().includes("program") ? "program_completion" : "course_completion");

  let baseXP = config.BASE_XP[docType] || config.COMPLETION_CERT_BASE_XP;
  let baseTrust = config.BASE_TRUST_POINTS[docType] || 4;

  // 3. Proctored / Exam feature detection
  const hasExamScore =
    Boolean(credential.score_details?.proctored_exam) ||
    Boolean(credential.scores?.some((s) => s.label_as_printed?.toLowerCase().includes("exam")));

  if (hasExamScore) {
    baseXP += config.PROCTORED_EXAM_BONUS_XP;
    baseTrust += 6;
  }

  const xpEarned = Math.round(baseXP * multiplier);
  const trustEarned = Math.round(baseTrust * multiplier);

  let reason = "No points awarded.";
  if (status === "ISSUER_CONFIRMED") {
    reason = hasExamScore
      ? `Full XP awarded for confirmed proctored exam credential (${xpEarned} XP)`
      : `Full XP awarded for confirmed ${docType} credential (${xpEarned} XP)`;
  } else if (status === "MANUALLY_CONFIRMED") {
    reason = `Manually confirmed credential (75% weight) (${xpEarned} XP)`;
  } else if (status === "DOCUMENT_READ") {
    reason = `Reduced XP awarded (25% weight) for document-read proof pending issuer API (${xpEarned} XP)`;
  } else if (status === "NAME_MISMATCH") {
    reason = "0 XP: Recipient name differs from candidate account.";
  } else if (status === "REJECTED") {
    reason = "0 XP: Certificate failed verification checks.";
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
 * Idempotently recalculates total XP and Trust for a user from their active stored certificates.
 * Enforces the MAX_TOTAL_TRUST_BOOST cap.
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
    if (cert.verificationStatus === "ISSUER_CONFIRMED" || cert.verificationStatus === "MANUALLY_CONFIRMED") {
      confirmedCount++;
    }
    if (cert.verificationStatus === "DOCUMENT_READ") {
      readCount++;
    }
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
    confirmedCount,
    readCount,
  };
}

module.exports = {
  calculateCredentialScore,
  recalculateUserCertificateScore,
};
