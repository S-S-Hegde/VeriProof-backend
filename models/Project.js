const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    user: {
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
    technologies: {
      type: [String],
      required: true,
    },
    repositoryUrl: {
      type: String,
      required: true,
    },
    liveUrl: {
      type: String,
    },
    images: {
      type: [String], // URLs of uploaded images
    },
    githubStats: {
      commitsCount: { type: Number, default: 0 },
      lastCommitDate: { type: Date },
      languages: { type: Object },
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

const Project = mongoose.model("Project", projectSchema);
module.exports = Project;
