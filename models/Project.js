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

const linkedRepoSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  role:          { type: String, default: "Service" }, // "Frontend", "Backend", "AI / Python Engine", "Microservice"
  repositoryUrl: { type: String, required: true },
  technologies:  { type: [String], default: [] },
  isVerified:    { type: Boolean, default: true },
  commitsCount:  { type: Number, default: 0 },
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
    isComposite:  { type: Boolean, default: false },
    linkedRepositories: [linkedRepoSchema],
    cgpa:         { type: String, default: "" },
    rankings:     { type: rankingSchema, default: () => ({}) },
    githubStats: {
      commitsCount:  { type: Number, default: 0 },
      lastCommitDate:{ type: Date },
      languages:     { type: Object },
      stars:         { type: Number, default: 0 },
      forks:         { type: Number, default: 0 },
    },
    isVerified: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["Draft", "Published", "Pending", "Verified"],
      default: "Published",
    },

    // ── AI-Generated Intelligence (populated by GitHub auto-analysis) ──────────
    // NEVER overwritten if candidateEdits.summaryEdited = true
    aiGenerated: {
      projectSummary:       { type: String, default: "" },
      architectureOverview: { type: String, default: "" },
      techStack:            { type: [String], default: [] },
      detectedApis:         { type: [String], default: [] },
      authMethod:           { type: String, default: "" },
      databaseLayer:        { type: String, default: "" },
      folderStructure:      { type: String, default: "" },
      majorFeatures:        { type: [String], default: [] },
      howToRun:             { type: String, default: "" },
      knownLimitations:     { type: [String], default: [] },
      generatedReadme:      { type: String, default: "" },
      wasReadmeGenerated:   { type: Boolean, default: false },
      analyzedAt:           { type: Date },
    },

    // ── Candidate Edits ──────────────────────────────────────────────────────
    // When summaryEdited = true, re-runs of GitHub analysis must NOT overwrite
    // descriptionOverride or docsOverride.
    candidateEdits: {
      summaryEdited:        { type: Boolean, default: false },
      descriptionOverride:  { type: String, default: "" },
      docsOverride:         { type: String, default: "" },
      lastEditedAt:         { type: Date },
    },

    // ── Live Demo & Dual-Source Verification ────────────────────────────────
    liveDemoUrl:          { type: String, default: "" },
    verificationStatus:   { type: String, enum: ["Unverified", "Pending", "Verified", "Discrepancy"], default: "Unverified" },
    matchScore:           { type: Number, default: 0 },
    proofHash:            { type: String, default: "" },
    liveAuditReport: {
      demoCrawled:        { type: Boolean, default: false },
      githubAudited:      { type: Boolean, default: false },
      resumeFidelityScore:{ type: Number, default: 0 },
      verifiedFeatures:   { type: [String], default: [] },
      discrepancies:      { type: [String], default: [] },
      summary:            { type: String, default: "" },
      auditedAt:          { type: Date },
      verifierModel:      { type: String, default: "" },
    },

    // ── Source type flags ────────────────────────────────────────────────────
    sourceType: {
      type: String,
      enum: ["manual", "github_auto", "resume_auto"],
      default: "manual",
    },
  },
  { timestamps: true },
);

// Compound index to prevent duplicate auto-created projects per user+repo
projectSchema.index({ user: 1, repositoryUrl: 1 }, { unique: true, sparse: true });

const Project = mongoose.model("Project", projectSchema);
module.exports = Project;
