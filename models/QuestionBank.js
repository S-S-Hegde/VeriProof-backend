const mongoose = require("mongoose");

const questionBankSchema = new mongoose.Schema(
  {
    skillName: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    archetype: {
      type: String,
      required: true,
      enum: [
        "Code Tracing",
        "System Design",
        "Debugging",
        "Anti-patterns",
        "Core Concepts",
        "General Architecture",
        "Scenario Debug",
        "Architecture Flaw",
        "Output Prediction",
        "Refactoring Choice",
        "Memory Leak Detection",
      ],
      default: "Core Concepts",
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    correct_answer: {
      type: String,
      required: true,
      trim: true,
    },
    distractors: {
      type: [String],
      required: true,
      validate: [
        (val) => Array.isArray(val) && val.length >= 3,
        "Distractors must contain at least 3 incorrect options",
      ],
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Medium",
    },

    // ── Adaptive CAT Engine Fields ──────────────────────────────────────

    // Granular 1-5 difficulty for adaptive tier selection
    // 1=Foundational, 2=Easy, 3=Medium, 4=Hard, 5=Expert
    difficultyTier: {
      type: Number,
      min: 1,
      max: 5,
      default: 3,
    },

    // Which exam phase this question is eligible for
    category: {
      type: String,
      enum: ["calibration", "adaptive", "trap", "any"],
      default: "any",
    },

    // Scenario type — for Part 2 adaptive round, only non-conceptual allowed
    scenarioType: {
      type: String,
      enum: [
        "conceptual",
        "code_debug",
        "architecture_flaw",
        "output_prediction",
        "refactoring_choice",
        "memory_leak_detection",
        "spot_the_bug",
      ],
      default: "conceptual",
    },

    // Code snippet that makes the question un-Googleable (for scenario questions)
    codeSnippet: {
      type: String,
      default: "",
    },

    // Programming language of the code snippet (for syntax highlighting)
    codeLanguage: {
      type: String,
      default: "",
    },

    // ── Trap Question Fields ────────────────────────────────────────────

    // Marks this as a trap question (textbook answer vs production-safe answer)
    isTrapQuestion: {
      type: Boolean,
      default: false,
    },

    // Explains why the production-safe answer differs from textbook
    trapExplanation: {
      type: String,
      default: "",
    },

    // The "textbook" answer index that memorizers would pick (trap bait)
    trapBaitIndex: {
      type: Number,
      default: -1,
    },

    // ── Quality Pipeline Fields ─────────────────────────────────────────

    // Automated quality gate score from Pass 3 pipeline (0-100)
    qualityScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 100,
    },

    // Standard deviation of option character lengths at generation time
    lengthVariance: {
      type: Number,
      default: 0,
    },

    // Whether this question passed all automated quality gates
    qualityApproved: {
      type: Boolean,
      default: true,
    },

    // Source: "seed" (handcrafted), "llm" (generated), "llm_validated" (generated + passed gates)
    source: {
      type: String,
      enum: ["seed", "llm", "llm_validated"],
      default: "seed",
    },

    // Number of times this question has been served in exams
    servedCount: {
      type: Number,
      default: 0,
    },

    // Discrimination index: how well this question separates good/bad candidates
    discriminationIndex: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for fast adaptive querying
questionBankSchema.index({ skillName: 1, difficulty: 1 });
questionBankSchema.index({ skillName: 1, difficultyTier: 1, category: 1 });
questionBankSchema.index({ category: 1, scenarioType: 1 });
questionBankSchema.index({ isTrapQuestion: 1, skillName: 1 });

const QuestionBank = mongoose.model("QuestionBank", questionBankSchema);
module.exports = QuestionBank;
