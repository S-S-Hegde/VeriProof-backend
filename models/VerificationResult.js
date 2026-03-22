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
