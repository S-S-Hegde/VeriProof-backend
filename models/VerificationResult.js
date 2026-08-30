const mongoose = require("mongoose");

const verificationResultSchema = mongoose.Schema(
  {
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
      index: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      ref: "Job",
      index: true,
    },
    resumeText: {
      type: String,
    },
    sourceAnalysisId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ResumeAnalysis",
    },
    claimedSkills: { type: [String], default: [] },
    matchedSkills: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam" },
    alignmentScore: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["Pending Exam", "Verified", "Failed", "In Review", "Completed"],
      default: "In Review",
    },
    examScore: {
      type: Number,
      default: 0,
    },

    // ── Phase 4: Triangulation & Discrepancy Engine Fields ──
    claimScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    repoEvidenceScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    examDefenseScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    stage1Score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    stage2Score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    divergence: {
      type: Number,
      default: 0,
    },
    classification: {
      type: String,
      enum: [
        "VERIFIED_TALENT",
        "HIDDEN_GEM",
        "OVERSTATED_PROFILE",
        "ANOMALOUS_EVIDENCE",
        "STANDARD_CANDIDATE",
        "IN_REVIEW",
      ],
      default: "IN_REVIEW",
    },
    defenseQuestions: [
      {
        scenario_question: { type: String },
        candidate_answer: { type: String },
        score: { type: Number, default: 0 },
        feedback: { type: String },
        gradedAt: { type: Date },
      },
    ],
    triangulationSummary: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Triangulation helper function to calculate Divergence and Classification.
 *
 * Classification rules:
 * - Divergence <= 20 AND examDefenseScore >= 75 -> "VERIFIED_TALENT"
 * - examDefenseScore >= 75 AND claimScore < 60 -> "HIDDEN_GEM"
 * - claimScore >= 80 AND examDefenseScore < 50 -> "OVERSTATED_PROFILE"
 * - repoEvidenceScore >= 80 AND examDefenseScore < 40 -> "ANOMALOUS_EVIDENCE" (Potential code provenance fraud)
 * - Otherwise: "STANDARD_CANDIDATE" or "IN_REVIEW"
 */
verificationResultSchema.statics.calculateClassification = function (
  claimScore = 0,
  repoEvidenceScore = 0,
  examDefenseScore = 0
) {
  const cScore = Math.max(0, Math.min(100, Number(claimScore) || 0));
  const rScore = Math.max(0, Math.min(100, Number(repoEvidenceScore) || 0));
  const eScore = Math.max(0, Math.min(100, Number(examDefenseScore) || 0));

  const divergence = Math.abs(rScore - eScore);

  let classification = "STANDARD_CANDIDATE";
  let summary = "";

  if (rScore >= 80 && eScore < 40) {
    classification = "ANOMALOUS_EVIDENCE";
    summary = "High AST complexity detected in repository but severe deficit in examination defense. Potential code provenance anomaly or external authorship.";
  } else if (cScore >= 80 && eScore < 50) {
    classification = "OVERSTATED_PROFILE";
    summary = "Significant gap between resume claims and observed technical assessment performance.";
  } else if (eScore >= 75 && cScore < 60) {
    classification = "HIDDEN_GEM";
    summary = "Candidate demonstrated exceptional problem-solving and architectural defense surpassing baseline resume expectations.";
  } else if (divergence <= 20 && eScore >= 75) {
    classification = "VERIFIED_TALENT";
    summary = "Consistent high-caliber performance across codebase evidence, technical assessment, and architectural defense.";
  } else {
    classification = eScore >= 50 ? "STANDARD_CANDIDATE" : "IN_REVIEW";
    summary = `Candidate completed evaluation with divergence index ${divergence.toFixed(1)}.`;
  }

  return {
    divergence,
    classification,
    summary,
  };
};

const VerificationResult = mongoose.model(
  "VerificationResult",
  verificationResultSchema
);

module.exports = VerificationResult;
