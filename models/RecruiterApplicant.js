const mongoose = require("mongoose");

const recruiterApplicantSchema = new mongoose.Schema({
  recruiterId:       { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  jobId:             { type: mongoose.Schema.Types.ObjectId, ref: "Job",  required: true, index: true },
  originalFileName:  { type: String, required: true },
  mimeType:          { type: String, required: true },
  fileUrl:           { type: String, required: true },
  status:            { type: String, enum: ["Processing", "Completed", "Failed"], default: "Processing" },
  resumeText:        { type: String, default: "" },
  claims:            { type: mongoose.Schema.Types.Mixed, default: {} },
  analysis:          { type: mongoose.Schema.Types.Mixed, default: {} },
  claimedSkills:     { type: [String], default: [] },
  matchedSkills:     { type: [String], default: [] },
  missingSkills:     { type: [String], default: [] },
  alignmentScore:    { type: Number, min: 0, max: 100, default: 0 },
  error:             { type: String, default: "" },
  processedAt:       Date,
  candidateUser:     { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  extractedName:     { type: String, default: "" },
  extractedEmail:    { type: String, default: "" },
  githubUsername:    { type: String, default: "", index: true },
  emailSentTo:       { type: String, default: "" },
  emailStatus:       { type: String, enum: ["sent", "failed", "not_found"], default: "not_found" },
  reasoning:         { type: String, default: "" },
  v2Report:          { type: mongoose.Schema.Types.Mixed, default: null },
  contentHash:       { type: String, default: "", index: true },

  // Post-exam daily digest fields
  examCompletedAt:   Date,
  examDigestPending: { type: Boolean, default: false },
  examFailedReasons: { type: [String], default: [] },

  // Recruiter shortlist ordering (drag-and-drop)
  shortlistRank:     { type: Number, default: null },
  shortlisted:       { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("RecruiterApplicant", recruiterApplicantSchema);

