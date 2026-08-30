const mongoose = require("mongoose");

const certificateSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Certificate title is required"],
      trim: true,
    },
    issuer: {
      type: String,
      required: [true, "Issuing organization is required"],
      trim: true,
    },
    issueDate: {
      type: Date,
      default: Date.now,
    },
    expiryDate: {
      type: Date,
    },
    credentialId: {
      type: String,
      trim: true,
      default: "",
    },
    credentialUrl: {
      type: String,
      trim: true,
      default: "",
    },
    fileUrl: {
      type: String,
      default: "",
    },
    fileType: {
      type: String,
      default: "application/pdf",
    },
    skills: {
      type: [String],
      default: [],
    },
    verificationStatus: {
      type: String,
      enum: ["Verified", "Pending", "Under_Review"],
      default: "Verified",
    },
    trustScoreBonus: {
      type: Number,
      default: 5,
    },
    xpAwarded: {
      type: Number,
      default: 250,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Certificate", certificateSchema);
