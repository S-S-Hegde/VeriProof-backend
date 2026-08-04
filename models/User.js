const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const skillNodeSchema = new mongoose.Schema({
  id:                { type: String, required: true },
  name:              { type: String, required: true },
  type:              { type: String, enum: ["category", "skill"], default: "skill" },
  category:          { type: String, enum: ["verified", "foundational", "recommended"] },
  categoryKey:       { type: String, default: "" },
  categoryName:      { type: String, default: "" },
  parentId:          { type: String, default: null },
  prerequisites:     { type: [String], default: [] },
  status:            { type: String, enum: ["locked", "unlocked", "in_progress", "verified"], default: "locked" },
  progress:          { type: Number, min: 0, max: 100, default: 0 },
  confidence:        { type: Number, min: 0, max: 100 },
  verificationScore: { type: Number, min: 0, max: 100, default: 0 },
  xp:                { type: Number, default: 0 },
  level:             { type: Number, default: 1 },
  accent:            { type: String, default: "#38bdf8" },
  x:                 { type: Number },
  y:                 { type: Number },
  evidence:          { type: mongoose.Schema.Types.Mixed, default: [] },
}, { _id: false });

const skillEvidenceSchema = new mongoose.Schema({
  type:      { type: String, default: "system" },
  source:    { type: String, default: "" },
  label:     { type: String, default: "" },
  score:     { type: Number, min: 0, max: 100, default: 0 },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const skillProgressSchema = new mongoose.Schema({
  id:                { type: String, required: true },
  status:            { type: String, enum: ["locked", "unlocked", "in_progress", "verified"], default: "locked" },
  progress:          { type: Number, min: 0, max: 100, default: 0 },
  verificationScore: { type: Number, min: 0, max: 100, default: 0 },
  xp:                { type: Number, default: 0 },
  level:             { type: Number, default: 1 },
  evidence:          { type: [skillEvidenceSchema], default: [] },
  unlockedAt:        { type: Date },
  completedAt:       { type: Date },
}, { _id: false });

const achievementSchema = new mongoose.Schema({
  id:          { type: String, required: true },
  title:       { type: String, required: true },
  description: { type: String, default: "" },
  icon:        { type: String, default: "Award" },
  unlocked:    { type: Boolean, default: false },
  unlockedAt:  { type: Date },
}, { _id: false });

const userSchema = new mongoose.Schema(
  {
    name:           { type: String, required: true },
    email:          { type: String, required: true, unique: true },
    password:       { type: String, required: true },
    role:           { type: String, enum: ["student", "recruiter"], default: "student" },

    // Single source of truth for candidate workflow architecture
    origin: {
      type: String,
      enum: ["self_registered", "recruiter_invited"],
    },
    pipeline: {
      type: String,
      enum: ["self_candidate_pipeline", "invited_candidate_pipeline", "recruiter_pipeline"],
    },
    pipelineStage: {
      type: String,
      enum: [
        "registration",
        "resume_upload",
        "resume_analysis",
        "repository_analysis",
        "project_intelligence",
        "technical_assessment",
        "candidate_complete",
        "waiting_for_recruiter",
        "verification_complete"
      ],
    },

    githubUsername: { type: String, default: "" },
    profileImage:   { type: String, default: "" },

    // Profile / social
    bio:            { type: String, default: "" },
    phone:          { type: String, default: "" },
    location:       { type: String, default: "" },
    website:        { type: String, default: "" },
    linkedin:       { type: String, default: "" },
    twitter:        { type: String, default: "" },
    instagram:      { type: String, default: "" },

    // Academic
    college:        { type: String, default: "" },
    branch:         { type: String, default: "" },
    usn:            { type: String, default: "" },          // VTU USN
    batch:          { type: String, default: "" },          // e.g. 2021-2025
    cgpa:           { type: String, default: "" },

    // Skills (global, not per-project)
    skills:         { type: [String], default: [] },

    // Certificates
    certificates: [{
      title:        { type: String, required: true },
      issuedAt:     { type: Date, default: Date.now },
      issuer:       { type: String, default: "VeriProof Authority" },
      credentialId: { type: String, unique: true, sparse: true },
      techStack:    { type: [String] },
      verificationUrl: { type: String }
    }],

    // Resume
    resumeUrl:      { type: String, default: "" },
    resumeStatus:   {
      type: String,
      enum: ["Pending Evaluation", "Analyzed", "Verified", "Rejected"],
      default: "Pending Evaluation",
    },

    // Notifications / privacy prefs
    notifications: {
      email:    { type: Boolean, default: true },
      platform: { type: Boolean, default: true },
    },
    profileVisibility: {
      type: String,
      enum: ["public", "recruiters-only", "private"],
      default: "public",
    },
    savedProjects: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
    }],

    // AI-Generated Skill Tree
    skillTree: {
      nodes:       { type: [skillNodeSchema], default: [] },
      generatedAt: { type: Date },
      sourceHash:  { type: String, default: "" },
    },

    skillProgress: {
      skills:               { type: [skillProgressSchema], default: [] },
      achievements:         { type: [achievementSchema], default: [] },
      totalXp:              { type: Number, default: 0 },
      level:                { type: Number, default: 1 },
      progressPercent:      { type: Number, default: 0 },
      verificationScore:    { type: Number, default: 0 },
      githubScore:          { type: Number, default: 0 },
      trustScore:           { type: Number, default: 0 },
      streakDays:           { type: Number, default: 0 },
      verifiedCount:        { type: Number, default: 0 },
      unlockedCount:        { type: Number, default: 0 },
      totalSkills:          { type: Number, default: 0 },
      completedAssessments: { type: Number, default: 0 },
      lastUpdated:          { type: Date },
    },

    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  { timestamps: true },
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate and hash password token
userSchema.methods.getResetPasswordToken = function () {
  const resetToken = crypto.randomBytes(20).toString("hex");

  // Hash token and set to resetPasswordToken field
  this.resetPasswordToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");

  // Set expire (10 minutes)
  this.resetPasswordExpire = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

const User = mongoose.model("User", userSchema);
module.exports = User;
