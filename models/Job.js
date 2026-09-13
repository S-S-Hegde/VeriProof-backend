const mongoose = require("mongoose");

const jobSchema = mongoose.Schema(
  {
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    targetSkills: {
      type: [String],
      required: true,
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    assessmentSettings: {
      questionCount: { type: Number, default: 40 },
      durationMinutes: { type: Number, default: 45 },
      jdRatio: { type: Number, default: 0.70 },
      resumeRatio: { type: Number, default: 0.30 },
      difficulty: { type: String, default: "intermediate" },

      // ── Adaptive CAT Engine Settings ──────────────────────────────
      // Enable 2-part adaptive examination (calibration → purgatory → adaptive)
      adaptiveMode: { type: Boolean, default: true },

      // Ratio of calibration (Part 1) to total questions (default 50/50)
      calibrationRatio: { type: Number, default: 0.50, min: 0.30, max: 0.70 },

      // Purgatory intermission duration (recruiter-configurable, min 5, max 15)
      purgatoryDurationMinutes: { type: Number, default: 10, min: 5, max: 15 },

      // Include trap questions in Part 1 to catch memorizers
      enableTrapQuestions: { type: Boolean, default: true },

      // Force webcam re-verification when starting Part 2 (anti-seat-swap)
      enableReverification: { type: Boolean, default: true },

      // Show confidence selector on Hard/Expert questions in Part 2
      enableConfidenceCalibration: { type: Boolean, default: true },

      // Escalate difficulty until failure to find true skill ceiling
      enableSkillCeiling: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
  }
);

const Job = mongoose.model("Job", jobSchema);
module.exports = Job;
