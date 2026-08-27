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
    },
  },
  {
    timestamps: true,
  }
);

const Job = mongoose.model("Job", jobSchema);
module.exports = Job;
