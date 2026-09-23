const mongoose = require("mongoose");

const questionSchema = mongoose.Schema({
  questionText: { type: String, required: true },
  options: { type: [String], required: true },
  correctOption: { type: Number, required: true }, // Index of correct option (0-3)
  skill: { type: String, default: "Technical" },
  difficulty: { type: String, default: "Medium" },
  section: { type: String, default: "Core" }, // "Core" or "Elective"
  // Adaptive CAT fields
  difficultyTier: { type: Number, min: 1, max: 5, default: 3 },
  scenarioType: { type: String, default: "conceptual" },
  codeSnippet: { type: String, default: "" },
  codeLanguage: { type: String, default: "" },
  isTrapQuestion: { type: Boolean, default: false },
  trapBaitIndex: { type: Number, default: -1 },
  phase: { type: String, enum: ["calibration", "adaptive", "core", "elective"], default: "calibration" },
});

const defenseSubmissionSchema = mongoose.Schema({
  scenario_question: { type: String, required: true },
  candidate_answer: { type: String, required: true },
  score: { type: Number, default: 0 },
  feedback: { type: String, default: "" },
}, { _id: false });

// Per-question response timing for adaptive profiling
const responseTimingSchema = mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId },
  startedAt: { type: Date },
  answeredAt: { type: Date },
  durationMs: { type: Number, default: 0 },
  changedAnswer: { type: Boolean, default: false },
}, { _id: false });

// Per-skill DNA fingerprint from calibration round profiling
const skillDNAEntrySchema = mongoose.Schema({
  skill: { type: String, required: true },
  accuracy: { type: Number, default: 0 },        // 0-100%
  avgResponseMs: { type: Number, default: 0 },   // average response time in ms
  totalQuestions: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  tier: {
    type: String,
    enum: ["foundational", "intermediate", "advanced"],
    default: "intermediate",
  },
  guessFlagged: { type: Boolean, default: false },
  trapCapped: { type: Boolean, default: false },  // true if candidate fell for trap → skill capped
  trapQuestionIds: [{ type: mongoose.Schema.Types.ObjectId }],
  trapFailed: { type: Boolean, default: false },
}, { _id: false });

// Trap question result tracking
const trapResultSchema = mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId },
  skill: { type: String },
  fellForTrap: { type: Boolean, default: false },
  selectedBaitIndex: { type: Number, default: -1 },
}, { _id: false });

// Confidence calibration for Hard/Expert questions in Part 2
const confidenceEntrySchema = mongoose.Schema({
  questionId: { type: mongoose.Schema.Types.ObjectId },
  confidence: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  wasCorrect: { type: Boolean, default: false },
}, { _id: false });

// Rank penalty tracking
const rankPenaltySchema = mongoose.Schema({
  type: {
    type: String,
    enum: ["purgatory_timeout", "identity_swap", "trap_cap", "guess_pattern", "integrity_violation"],
  },
  detail: { type: String, default: "" },
  penaltyMultiplier: { type: Number, default: 1.0 },
  appliedAt: { type: Date, default: Date.now },
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

    // ══════════════════════════════════════════════════════════════════
    // ── ADAPTIVE CAT ENGINE FIELDS ──────────────────────────────────
    // ══════════════════════════════════════════════════════════════════

    // Exam mode: "standard" (legacy single-phase) or "adaptive" (2-part CAT)
    examMode: {
      type: String,
      enum: ["standard", "adaptive"],
      default: "standard",
    },

    // Current phase in the adaptive exam lifecycle
    currentPhase: {
      type: String,
      enum: ["calibration", "purgatory", "reverification", "adaptive", "completed", "expired", "legacy_active"],
      default: "calibration",
    },

    // ── Part 1: Calibration Round ───────────────────────────────────
    calibrationQuestions: [questionSchema],    // Part 1 question set (stored separately)
    calibrationAnswers: [{                      // Part 1 answers with timing data
      questionId: { type: mongoose.Schema.Types.ObjectId },
      answerIndex: { type: Number },
      responseTimeMs: { type: Number, default: 0 },
      changedAnswer: { type: Boolean, default: false },
    }],
    calibrationScore: { type: Number, default: 0 },
    calibrationSubmittedAt: { type: Date },

    // ── Skill DNA Fingerprint (built from Part 1 profiling) ─────────
    skillDNA: [skillDNAEntrySchema],

    // ── Purgatory Intermission ──────────────────────────────────────
    purgatoryDeadline: { type: Date },          // calibrationSubmittedAt + N minutes
    purgatoryDurationMinutes: { type: Number, default: 10 },
    purgatoryExpired: { type: Boolean, default: false },

    // ── Part 2: Adaptive Round ──────────────────────────────────────
    adaptiveQuestions: [questionSchema],        // Part 2 question set (generated during purgatory)
    adaptiveAnswers: [{
      questionId: { type: mongoose.Schema.Types.ObjectId },
      answerIndex: { type: Number },
      responseTimeMs: { type: Number, default: 0 },
      changedAnswer: { type: Boolean, default: false },
    }],
    adaptiveScore: { type: Number, default: 0 },
    adaptiveSubmittedAt: { type: Date },

    // ── Response Timing (all questions) ─────────────────────────────
    responseTimings: [responseTimingSchema],

    // ── Trap Question Results ───────────────────────────────────────
    trapResults: [trapResultSchema],

    // ── Confidence Calibration (Hard/Expert questions in Part 2) ────
    candidateConfidence: [confidenceEntrySchema],

    // ── Re-Verification Gate ────────────────────────────────────────
    reverificationSnapshot: { type: String, default: "" },  // base64 webcam capture
    reverificationPassed: { type: Boolean, default: null },  // null = not yet checked
    reverificationTimestamp: { type: Date },

    // ── Composite Forensic Ranking ──────────────────────────────────
    adaptiveRankScore: { type: Number, default: 0 },  // Final composite rank (0-100)
    skillCeiling: { type: Map, of: Number, default: {} },  // Highest proven tier per skill
    consistencyIndex: { type: Number, default: 0 },    // How consistent across skills (0-100)
    responseQualityScore: { type: Number, default: 0 }, // Speed + accuracy combo (0-100)

    // Rank penalties applied
    rankPenalties: [rankPenaltySchema],

    // Partial finalization (if purgatory expired, only Part 1 scores used)
    partialFinalization: { type: Boolean, default: false },

    // ── Guess Pattern Detection ─────────────────────────────────────
    guessPatternDetected: { type: Boolean, default: false },
    guessPatternConfidence: { type: Number, default: 0 },
    guessPatternQuestionIds: [{ type: mongoose.Schema.Types.ObjectId }],
  },
  {
    timestamps: true,
  }
);

// Indexes for ranking queries
examSchema.index({ jobId: 1, adaptiveRankScore: -1 });
examSchema.index({ candidateId: 1, examMode: 1 });

const Exam = mongoose.model("Exam", examSchema);
module.exports = Exam;
