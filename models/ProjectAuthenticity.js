/**
 * ProjectAuthenticity.js
 *
 * Stores all project-level authenticity signals produced by
 * projectAuthenticityService.js for a single claimed project per candidate.
 *
 * This document is created during the Purgatory Intermission window and
 * consumed by:
 *  - examController.js  (answer submission + recruiter GET route)
 *  - VerificationPanel.jsx (recruiter-facing UI)
 *  - Prompt B scoring (FRAUD_RISK feed-in)
 */

const mongoose = require("mongoose");

// ── Per-commit interrogation question + graded answer ─────────────────────────
const interrogationQuestionSchema = new mongoose.Schema(
  {
    commitSha:        { type: String, default: "" },
    diffSummary:      { type: String, default: "" },   // trimmed diff context shown to LLM
    question:         { type: String, required: true },
    expectedAnswerShape: { type: String, default: "" },// NOT shown to candidate; used for grading
    candidateAnswer:  { type: String, default: "" },
    specificityScore: { type: Number, min: 0, max: 100, default: null }, // null = not yet graded
    graderRationale:  { type: String, default: "" },
    answeredAt:       { type: Date },
  },
  { _id: true }
);

// ── Peer-candidate fingerprint match entry ────────────────────────────────────
const peerMatchSchema = new mongoose.Schema(
  {
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    score:       { type: Number, min: 0, max: 100, default: 0 },
  },
  { _id: false }
);

// ── Main schema ───────────────────────────────────────────────────────────────
const projectAuthenticitySchema = new mongoose.Schema(
  {
    // ── Identity Links ─────────────────────────────────────────────────────
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      index: true,
    },
    repoUrl: { type: String, required: true },

    // ── Step 1: Ownership & Provenance ─────────────────────────────────────
    repoOwnerVerified:          { type: Boolean, default: null },  // null = not yet checked
    isFork:                     { type: Boolean, default: false },
    forkUpstream:               { type: String, default: null },   // upstream URL or null
    bulkImportFlag:             { type: Boolean, default: false },
    accountAgeConsistencyFlag:  { type: Boolean, default: false },
    commitCount:                { type: Number, default: 0 },
    firstCommitAt:              { type: Date },
    lastCommitAt:               { type: Date },

    // ── Step 2: Fingerprint Similarity ─────────────────────────────────────
    fingerprintSimilarity: {
      knownCorpusMatch: { type: Number, min: 0, max: 100, default: 0 },
      peerCandidateMatch: [peerMatchSchema],
    },

    // ── Step 3: Style Deviation ────────────────────────────────────────────
    styleDeviationScore: { type: Number, min: 0, max: 100, default: 0 },

    // ── Step 4: Development Pattern Score ─────────────────────────────────
    developmentPatternScore: { type: Number, min: 0, max: 100, default: 50 },

    // ── Step 5: Interrogation Q&A ──────────────────────────────────────────
    interrogation: {
      questions: [interrogationQuestionSchema],
    },

    // ── Step 6: Composite Score & Status ──────────────────────────────────
    authenticityScore: { type: Number, min: 0, max: 100, default: null },
    reviewStatus: {
      type: String,
      enum: ["pending", "auto_pass", "auto_flag", "manual_review_required"],
      default: "pending",
    },

    // ── Computation meta ───────────────────────────────────────────────────
    computedAt:       { type: Date },
    pipelineErrors:   [{ type: String }],    // non-fatal errors logged per step
  },
  {
    timestamps: true,
  }
);

// Compound index: one doc per candidate + repo
projectAuthenticitySchema.index(
  { candidateId: 1, repoUrl: 1 },
  { unique: true, sparse: true }
);

const ProjectAuthenticity = mongoose.model(
  "ProjectAuthenticity",
  projectAuthenticitySchema
);

module.exports = ProjectAuthenticity;
