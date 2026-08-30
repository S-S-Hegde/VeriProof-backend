const mongoose = require("mongoose");

const questionSchema = mongoose.Schema({
  questionText: { type: String, required: true },
  options: { type: [String], required: true },
  correctOption: { type: Number, required: true }, // Index of correct option (0-3)
  skill: { type: String, default: "Technical" },
  difficulty: { type: String, default: "Medium" },
  section: { type: String, default: "Core" }, // "Core" or "Elective"
});

const defenseSubmissionSchema = mongoose.Schema({
  scenario_question: { type: String, required: true },
  candidate_answer: { type: String, required: true },
  score: { type: Number, default: 0 },
  feedback: { type: String, default: "" },
}, { _id: false });

const examSchema = mongoose.Schema(
  {
    verificationResultId: { type: mongoose.Schema.Types.ObjectId, ref: "VerificationResult", index: true },
    sourceAnalysisId: { type: mongoose.Schema.Types.ObjectId, ref: "ResumeAnalysis" },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", index: true },
    jobTitle: { type: String, default: "" },
    recruiterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    skills: { type: [String], default: [] },
    projectContext: { type: [String], default: [] },
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
    
    // Two-Stage Hybrid Assessment Pipeline Metrics
    stage1Score: { type: Number, default: 0 },
    stage2Score: { type: Number, default: 0 },
    defenseSubmissions: [defenseSubmissionSchema],

    // Triangulation & Discrepancy Index
    claimScore: { type: Number, default: 0 },
    repoEvidenceScore: { type: Number, default: 0 },
    examDefenseScore: { type: Number, default: 0 },
    divergence: { type: Number, default: 0 },
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

    timeTaken: { type: Number, default: 0 },
    codeQuality: { type: Number, default: 0 },
    answers: { type: Array, default: [] },
    
    // Anti-Cheat & Proctoring Telemetry (Server-Authoritative)
    integrityScore: { type: Number, default: 100 },
    violationCount: { type: Number, default: 0 },
    serverViolationCount: { type: Number, default: 0 },
    violations: { type: Array, default: [] },
    serverViolations: { type: Array, default: [] },
    isTerminated: { type: Boolean, default: false },
    proctoringLogs: { type: Array, default: [] },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date },
    tamperAttemptCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

const Exam = mongoose.model("Exam", examSchema);
module.exports = Exam;
