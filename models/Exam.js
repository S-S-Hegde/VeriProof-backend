const mongoose = require("mongoose");

const questionSchema = mongoose.Schema({
  questionText: { type: String, required: true },
  options: { type: [String], required: true },
  correctOption: { type: Number, required: true }, // Index of correct option (0-3)
});

const examSchema = mongoose.Schema(
  {
    verificationResultId: { type: mongoose.Schema.Types.ObjectId, ref: "VerificationResult", index: true },
    sourceAnalysisId: { type: mongoose.Schema.Types.ObjectId, ref: "ResumeAnalysis" },
    skills: { type: [String], default: [] },
    topic: {
      type: String, // E.g., "MERN Stack Application", "React Fundamentals"
      required: true,
    },
    questions: [questionSchema],
    passingScore: {
      type: Number,
      required: true,
      default: 70, // 70%
    },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    status: { type: String, default: "Pending" },
    score: { type: Number, default: 0 },
    timeTaken: { type: Number, default: 0 },
    codeQuality: { type: Number, default: 0 },
    answers: { type: Array, default: [] },
    integrityScore: { type: Number, default: 100 }
  },
  {
    timestamps: true,
  }
);

const Exam = mongoose.model("Exam", examSchema);
module.exports = Exam;
