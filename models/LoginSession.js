const mongoose = require("mongoose");

/**
 * LoginSession — tracks every login event for security audit and device trust.
 * Used for:
 *  - Suspicious login detection (new IP or device → email alert)
 *  - Active session listing in account settings
 *  - Login history display
 */
const loginSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },

  // Device fingerprint (hash of UA + platform)
  deviceId: { type: String, default: "" },
  deviceName: { type: String, default: "Unknown Device" }, // "Chrome on Windows"
  browser: { type: String, default: "" },
  os: { type: String, default: "" },
  deviceType: { type: String, default: "desktop" }, // desktop | mobile | tablet

  // Network
  ip: { type: String, default: "" },
  country: { type: String, default: "" },

  // Auth method
  authMethod: {
    type: String,
    enum: ["password", "google_oauth", "otp", "totp"],
    default: "password",
  },

  // Trust status
  trusted: { type: Boolean, default: false },
  trustedAt: { type: Date },

  // Whether this session is still valid
  active: { type: Boolean, default: true },
  revokedAt: { type: Date },

  // JWT token identifier (first 16 chars of token hash for revocation)
  tokenId: { type: String, default: "" },

  // Timestamps
  lastSeenAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now, expires: 90 * 24 * 3600 }, // Auto-delete after 90 days
});

const LoginSession = mongoose.model("LoginSession", loginSessionSchema);
module.exports = LoginSession;
