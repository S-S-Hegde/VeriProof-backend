const mongoose = require("mongoose");

const rankingSchema = new mongoose.Schema({
  hackerrank:  { type: String, default: "" },
  leetcode:    { type: String, default: "" },
  codeforces:  { type: String, default: "" },
  codechef:    { type: String, default: "" },
  github:      { type: String, default: "" },
  other:       { type: String, default: "" },
}, { _id: false });

const snippetSchema = new mongoose.Schema({
  title:    { type: String, required: true },
  code:     { type: String, required: true },
  language: { type: String, default: "javascript" },
  explanation: { type: String }
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
  filename:     { type: String, required: true },
  originalName: { type: String, required: true },
  mimeType:     { type: String, required: true },
  size:         { type: Number, required: true },
  url:          { type: String, required: true },
  uploadedAt:   { type: Date, default: Date.now }
}, { _id: true });

const projectSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    title:        { type: String, required: true },
    description:  { type: String, required: true },
    technologies: { type: [String], required: true },
    repositoryUrl:{ type: String, required: true },
    liveUrl:      { type: String },
    images:       { type: [String] },
    featuredSnippets: [snippetSchema],
    attachments:  [attachmentSchema],
    cgpa:         { type: String, default: "" },
    rankings:     { type: rankingSchema, default: () => ({}) },
    githubStats: {
      commitsCount:  { type: Number, default: 0 },
      lastCommitDate:{ type: Date },
      languages:     { type: Object },
    },
    isVerified: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["Draft", "Published", "Pending", "Verified"],
      default: "Published",
    },
  },
  { timestamps: true },
);

const Project = mongoose.model("Project", projectSchema);
module.exports = Project;
