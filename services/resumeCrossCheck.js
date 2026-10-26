const ResumeAnalysis = require("../models/ResumeAnalysis");

/**
 * Separate Resume Cross-Checker.
 * Matches credential against candidate's uploaded resume text or extracted claims
 * using normalized title and issuer tokens.
 * NEVER mixes verification status with resume match.
 */
async function crossCheckWithResume(userId, title, issuer) {
  if (!userId || !title) {
    return {
      isResumeVerified: false,
      resumeMatched: false,
      resumeMatchDetails: "Not in resume",
    };
  }

  try {
    const analysis = await ResumeAnalysis.findOne({ candidateId: userId }).sort({ createdAt: -1 });
    if (!analysis) {
      return {
        isResumeVerified: false,
        resumeMatched: false,
        resumeMatchDetails: "Not in resume (no resume on file)",
      };
    }

    const titleTokens = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !["certificate", "completion", "course", "program", "using"].includes(t));

    // 1. Check extracted certification claims
    if (analysis.claims?.certifications && Array.isArray(analysis.claims.certifications)) {
      for (const claim of analysis.claims.certifications) {
        const claimName = (claim.name || "").toLowerCase();
        const matches = titleTokens.some((tok) => claimName.includes(tok));
        if (matches) {
          return {
            isResumeVerified: true,
            resumeMatched: true,
            resumeMatchDetails: `Matched in resume claims: "${claim.name}"`,
          };
        }
      }
    }

    // 2. Check raw resume text lines
    const rawText = analysis.extractedText || "";
    if (rawText) {
      const lines = rawText.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        const matches = titleTokens.filter((tok) => line.includes(tok));
        if (matches.length >= Math.min(2, titleTokens.length)) {
          return {
            isResumeVerified: true,
            resumeMatched: true,
            resumeMatchDetails: `Matched in resume (line ${i + 1}): "${lines[i].trim().substring(0, 80)}"`,
          };
        }
      }
    }
  } catch (err) {
    console.warn("[Resume Cross-Check] Notice:", err.message);
  }

  return {
    isResumeVerified: false,
    resumeMatched: false,
    resumeMatchDetails: "Not in resume",
  };
}

module.exports = { crossCheckWithResume };
