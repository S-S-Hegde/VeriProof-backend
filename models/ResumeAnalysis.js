const mongoose = require("mongoose");

const resumeAnalysisSchema = new mongoose.Schema(
  {
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
      index: true,
    },
    status: {
      type: String,
      enum: [
        "Uploading",
        "Queued",
        "Parsing",
        "Extracting Information",
        "Updating Skill Tree",
        "Analysis Complete",
        "Analysis Failed",
      ],
      default: "Queued",
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    stage: {
      type: String,
      default: "Queued for processing",
    },
    estimatedRemainingStage: {
      type: String,
      default: "Calculating...",
    },
    truncatedText: {
      type: String,
      default: "",
    },
    claims: {
      skills: [
        {
          id: { type: String, required: true },
          name: { type: String, required: true },
          source: { type: String, default: "Resume" },
          verificationStatus: { type: String, default: "Pending" },
          evidenceCount: { type: Number, default: 0 },
        },
      ],
      projects: [
        {
          id: { type: String, required: true },
          title: { type: String, required: true },
          description: { type: String, default: "" },
          verificationStatus: { type: String, default: "Pending" },
          evidenceCount: { type: Number, default: 0 },
        },
      ],
      certifications: [
        {
          id: { type: String, required: true },
          name: { type: String, required: true },
          verificationStatus: { type: String, default: "Pending" },
        },
      ],
      education: [
        {
          id: { type: String, required: true },
          degree: { type: String, required: true },
          university: { type: String, default: "" },
          graduationYear: { type: String, default: "" },
          verificationStatus: { type: String, default: "Pending" },
        },
      ],
      experience: [
        {
          id: { type: String, required: true },
          role: { type: String, required: true },
          company: { type: String, default: "" },
          verificationStatus: { type: String, default: "Pending" },
        },
      ],
      contactInfo: {
        fullName: { type: String, default: "" },
        email: { type: String, default: "" },
        phone: { type: String, default: "" },
        githubUrl: { type: String, default: "" },
        linkedinUrl: { type: String, default: "" },
      },
    },
    analysis: {
      missingFields: { type: [String], default: [] },
      parsingConfidence: { type: Number, default: 0 },
      resumeCompleteness: { type: Number, default: 0 },
      parseErrors: { type: [String], default: [] },
    },
    active: {
      type: Boolean,
      default: true,
    },
    analysisVersion: {
      type: String,
      default: "1.0.0",
    },
    engineVersion: {
      type: String,
      default: "1.0.0",
    },
    processedAt: {
      type: Date,
    },
    error: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const ResumeAnalysis = mongoose.model("ResumeAnalysis", resumeAnalysisSchema);

module.exports = ResumeAnalysis;
