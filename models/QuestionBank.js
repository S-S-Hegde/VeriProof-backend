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
  },
  {
    timestamps: true,
  }
);

// Compound index for fast skill querying and sampling
questionBankSchema.index({ skillName: 1, difficulty: 1 });

const QuestionBank = mongoose.model("QuestionBank", questionBankSchema);
module.exports = QuestionBank;
