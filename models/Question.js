const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    text:         { type: String, required: true },
    options:      { type: [String], required: true },
    correctIndex: { type: Number, required: true },
    category:     { type: String, required: true },
    difficulty:   { type: String, enum: ["Easy", "Medium", "Hard"], required: true }
  },
  { timestamps: true }
);

const Question = mongoose.model("Question", questionSchema);
module.exports = Question;
