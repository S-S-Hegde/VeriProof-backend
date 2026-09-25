/**
 * mfaRoutes.js
 *
 * All modern authentication security routes:
 *
 *  TOTP (Authenticator App)
 *  GET  /api/users/mfa/status                    — MFA settings + recent sessions
 *  GET  /api/users/mfa/totp/setup                — Generate TOTP secret + QR code
 *  POST /api/users/mfa/totp/enable               — Verify first TOTP token to activate
 *  POST /api/users/mfa/totp/verify               — Verify TOTP during login
 *  POST /api/users/mfa/totp/disable              — Disable TOTP (requires password)
 *  POST /api/users/mfa/totp/backup-codes         — Regenerate backup codes
 *
 *  Device Trust
 *  POST   /api/users/mfa/trust-device            — Trust current device
 *  DELETE /api/users/mfa/trust-device/:deviceId  — Revoke device trust
 *
 *  Session Management
 *  DELETE /api/users/mfa/sessions/:sessionId     — Revoke one session
 *  DELETE /api/users/mfa/sessions                — Revoke all other sessions
 *
 *  Security OTP (new device / suspicious login)
 *  POST /api/users/mfa/security-otp/send         — Send security OTP email (public — before login)
 *  POST /api/users/mfa/security-otp/verify       — Verify security OTP
 *
 *  Email Verification
 *  POST /api/users/mfa/verify-email/send         — Send verification email (protected)
 *  POST /api/users/mfa/verify-email/confirm      — Confirm via token link (public)
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/rateLimiter");

const {
  setupTotp,
  enableTotp,
  verifyTotp,
  disableTotp,
  regenerateBackupCodes,
  getMfaStatus,
  trustDevice,
  revokeDeviceTrust,
  revokeSession,
  revokeAllOtherSessions,
  sendSecurityOtp,
  verifySecurityOtp,
  sendEmailVerification,
  confirmEmailVerification,
} = require("../controllers/mfaController");

// MFA Status
router.get("/status", protect, getMfaStatus);

// TOTP Authenticator App
router.get("/totp/setup", protect, setupTotp);
router.post("/totp/enable", protect, enableTotp);
router.post("/totp/verify", authLimiter, verifyTotp);            // public — during login
router.post("/totp/disable", protect, disableTotp);
router.post("/totp/backup-codes", protect, regenerateBackupCodes);

// Device Trust
router.post("/trust-device", protect, trustDevice);
router.delete("/trust-device/:deviceId", protect, revokeDeviceTrust);

// Session Management
router.delete("/sessions", protect, revokeAllOtherSessions);
router.delete("/sessions/:sessionId", protect, revokeSession);

// Security OTP (new device / suspicious login — public)
router.post("/security-otp/send", authLimiter, sendSecurityOtp);
router.post("/security-otp/verify", authLimiter, verifySecurityOtp);

// Email Verification
router.post("/verify-email/send", protect, sendEmailVerification);
router.post("/verify-email/confirm", confirmEmailVerification);

module.exports = router;
