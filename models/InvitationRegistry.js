const mongoose = require("mongoose");

const invitationRegistrySchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    inviteCode: {
      type: String,
      index: true,
      trim: true,
    },
    githubUsername: {
      type: String,
      index: true,
      trim: true,
      lowercase: true,
    },
    recruiterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "registered"],
      default: "pending",
    },
    invitedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("InvitationRegistry", invitationRegistrySchema);
