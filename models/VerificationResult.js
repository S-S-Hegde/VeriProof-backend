const mongoose = require("mongoose");

const verificationResultSchema = mongoose.Schema(
  {
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Job",
    },
    resumeText: {
      type: String, // Mock extracted text
    },
    sourceAnalysisId: { type: mongoose.Schema.Types.ObjectId, ref: "ResumeAnalysis" },
    claimedSkills: { type: [String], default: [] },
    matchedSkills: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: "Exam" },
    alignmentScore: {
      type: Number, // 0-100% Mock parsing score
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending Exam", "Verified", "Failed", "In Review"],
      default: "In Review",
    },
    examScore: {
      type: Number, // 0-100% Exam performance
    },
  },
  {
    timestamps: true,
  }
);

const VerificationResult = mongoose.model(
  "VerificationResult",
  verificationResultSchema
);

module.exports = VerificationResult;
