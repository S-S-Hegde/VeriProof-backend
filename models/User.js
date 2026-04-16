const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const userSchema = new mongoose.Schema(
  {
    name:           { type: String, required: true },
    email:          { type: String, required: true, unique: true },
    password:       { type: String, required: true },
    role:           { type: String, enum: ["student", "recruiter"], default: "student" },
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

    // Resume
    resumeUrl:      { type: String, default: "" },
    resumeStatus:   {
      type: String,
      enum: ["Pending Evaluation", "Verified", "Rejected"],
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
    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  { timestamps: true },
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
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
