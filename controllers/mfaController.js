/**
 * mfaController.js
 *
 * Implements all modern authentication security features:
 *
 *  1. TOTP Authenticator App (Google Authenticator / Authy)
 *     - Setup (generate secret + QR code)
 *     - Enable (verify first TOTP token to confirm app configured correctly)
 *     - Verify (on each login)
 *     - Disable
 *     - Backup codes (8 single-use codes)
 *
 *  2. Device Trust
 *     - Trust this device (skip 2FA for 90 days)
 *     - List trusted devices
 *     - Revoke device trust
 *
 *  3. Login Sessions
 *     - List active sessions
 *     - Revoke individual session
 *     - Revoke all other sessions
 *
 *  4. Security OTP
 *     - Send email OTP for new device / suspicious login verification
 *     - Verify security OTP
 */

const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto");
const User = require("../models/User");
const LoginSession = require("../models/LoginSession");
const sendEmail = require("../utils/sendEmail");
const { getDeviceFingerprint, getClientIp } = require("../utils/deviceFingerprint");

const APP_NAME = "VeriProof";

// ─────────────────────────────────────────────────────────────────────────────
// TOTP SETUP — Generate secret + QR code (NOT enabled until verified)
// GET /api/users/mfa/totp/setup
// ─────────────────────────────────────────────────────────────────────────────
const setupTotp = async (req, res) => {
  try {
    const user = req.user;

    if (user.totpEnabled) {
      return res.status(400).json({
        message: "Authenticator app 2FA is already active on your account. Disable it first to reconfigure.",
      });
    }

    // Generate fresh secret every time (uncommitted until they verify)
    const secret = speakeasy.generateSecret({
      name: `${APP_NAME} (${user.email})`,
      issuer: APP_NAME,
      length: 20,
    });

    // Store the secret temporarily (base32 form) — not enabled yet
    user.totpSecret = secret.base32;
    user.totpEnabled = false;
    await user.save({ validateBeforeSave: false });

    // Generate QR code data URL
    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
      qrCode: qrDataUrl,
      message: "Scan the QR code with Google Authenticator, Authy, or any TOTP app. Then verify with the 6-digit code to activate.",
    });
  } catch (err) {
    console.error("[MFA] TOTP setup error:", err);
    res.status(500).json({ message: "Failed to setup authenticator app. Please try again." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOTP ENABLE — Verify the first token to confirm app is configured
// POST /api/users/mfa/totp/enable  { token }
// ─────────────────────────────────────────────────────────────────────────────
const enableTotp = async (req, res) => {
  try {
    const { token } = req.body;
    const user = req.user;

    if (!user.totpSecret) {
      return res.status(400).json({ message: "Run TOTP setup first before enabling." });
    }
    if (user.totpEnabled) {
      return res.status(400).json({ message: "Authenticator app 2FA is already active." });
    }
    if (!token || !/^\d{6}$/.test(token)) {
      return res.status(400).json({ message: "Please provide the 6-digit code from your authenticator app." });
    }

    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: "base32",
      token,
      window: 2, // allow ±1 time window for clock skew
    });

    if (!verified) {
      return res.status(400).json({ message: "Invalid code. Make sure your phone's time is synced and try again." });
    }

    // Generate 8 backup codes (shown ONCE, hashed and stored)
    const backupCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString("hex").toUpperCase()
    );

    const hashedBackupCodes = backupCodes.map((code) =>
      crypto.createHash("sha256").update(code).digest("hex")
    );

    user.totpEnabled = true;
    user.totpVerifiedAt = new Date();
    user.totpBackupCodes = hashedBackupCodes;
    await user.save({ validateBeforeSave: false });

    // Send confirmation email
    try {
      await sendEmail({
        email: user.email,
        subject: "[VeriProof] Authenticator App 2FA Activated",
        html: securityAlertEmail(user.name, "Authenticator App (TOTP) Enabled",
          "Two-factor authentication via authenticator app has been enabled on your VeriProof account.",
          "If you did not do this, your account may be compromised. Please change your password immediately."
        ),
      });
    } catch (e) {}

    res.json({
      message: "Authenticator app 2FA activated successfully.",
      backupCodes,
      warning: "Save these backup codes somewhere safe. Each code can only be used once if you lose your phone.",
      totpEnabled: true,
    });
  } catch (err) {
    console.error("[MFA] TOTP enable error:", err);
    res.status(500).json({ message: "Failed to enable authenticator app 2FA." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOTP VERIFY — Verify TOTP token during login
// POST /api/users/mfa/totp/verify  { email, token, sessionToken }
// ─────────────────────────────────────────────────────────────────────────────
const verifyTotp = async (req, res) => {
  try {
    const { email, token, trustDevice } = req.body;

    if (!email || !token) {
      return res.status(400).json({ message: "Email and TOTP token are required." });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return res.status(404).json({ message: "User not found." });

    if (!user.totpEnabled || !user.totpSecret) {
      return res.status(400).json({ message: "TOTP 2FA is not enabled on this account." });
    }

    // Try TOTP verification first
    let verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: "base32",
      token: token.replace(/\s/g, ""),
      window: 2,
    });

    let usedBackupCode = false;

    // If TOTP fails, check if it's a backup code
    if (!verified && token.length > 6) {
      usedBackupCode = user.consumeBackupCode(token);
      if (usedBackupCode) verified = true;
    }

    if (!verified) {
      return res.status(400).json({
        message: "Invalid authentication code. Check your authenticator app or use a backup code.",
      });
    }

    // Handle device trust
    const { deviceId, deviceName } = getDeviceFingerprint(req);
    const ip = getClientIp(req);

    if (trustDevice && deviceId) {
      if (!user.trustedDeviceIds.includes(deviceId)) {
        user.trustedDeviceIds.push(deviceId);
      }
    }

    user.recordSuccessfulLogin(ip, deviceId);
    await user.save({ validateBeforeSave: false });

    // Log session
    await LoginSession.create({
      userId: user._id,
      deviceId,
      deviceName,
      ip,
      authMethod: "totp",
      trusted: trustDevice || false,
      trustedAt: trustDevice ? new Date() : undefined,
    });

    const generateToken = require("../utils/generateToken");

    res.json({
      success: true,
      usedBackupCode,
      remainingBackupCodes: user.totpBackupCodes.length,
      token: generateToken(user._id),
      message: usedBackupCode
        ? `Backup code accepted. ${user.totpBackupCodes.length} backup code(s) remaining.`
        : "Authentication successful.",
    });
  } catch (err) {
    console.error("[MFA] TOTP verify error:", err);
    res.status(500).json({ message: "TOTP verification failed." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TOTP DISABLE
// POST /api/users/mfa/totp/disable  { password }
// ─────────────────────────────────────────────────────────────────────────────
const disableTotp = async (req, res) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user._id);

    if (!user.totpEnabled) {
      return res.status(400).json({ message: "Authenticator app 2FA is not enabled." });
    }

    // Require password re-confirmation to disable 2FA
    if (!password) {
      return res.status(400).json({ message: "Please confirm your password to disable 2FA." });
    }

    const passwordOk = await user.matchPassword(password);
    if (!passwordOk) {
      return res.status(401).json({ message: "Incorrect password. Cannot disable 2FA." });
    }

    user.totpEnabled = false;
    user.totpSecret = "";
    user.totpBackupCodes = [];
    user.totpVerifiedAt = undefined;
    await user.save({ validateBeforeSave: false });

    try {
      await sendEmail({
        email: user.email,
        subject: "[VeriProof] Authenticator App 2FA Disabled",
        html: securityAlertEmail(user.name, "Two-Factor Authentication Disabled",
          "Authenticator app 2FA has been disabled on your VeriProof account.",
          "If you did not do this, your account may be compromised. Re-enable 2FA and change your password immediately."
        ),
      });
    } catch (e) {}

    res.json({ message: "Authenticator app 2FA disabled successfully.", totpEnabled: false });
  } catch (err) {
    console.error("[MFA] TOTP disable error:", err);
    res.status(500).json({ message: "Failed to disable 2FA." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REGENERATE BACKUP CODES
// POST /api/users/mfa/totp/backup-codes  { password }
// ─────────────────────────────────────────────────────────────────────────────
const regenerateBackupCodes = async (req, res) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user._id);

    if (!user.totpEnabled) {
      return res.status(400).json({ message: "Authenticator app 2FA is not enabled." });
    }

    const passwordOk = await user.matchPassword(password);
    if (!passwordOk) {
      return res.status(401).json({ message: "Incorrect password." });
    }

    const backupCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString("hex").toUpperCase()
    );
    user.totpBackupCodes = backupCodes.map((c) =>
      crypto.createHash("sha256").update(c).digest("hex")
    );
    await user.save({ validateBeforeSave: false });

    res.json({
      backupCodes,
      message: "New backup codes generated. Previous codes are now invalid.",
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to regenerate backup codes." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MFA STATUS — Get current MFA settings for account settings page
// GET /api/users/mfa/status
// ─────────────────────────────────────────────────────────────────────────────
const getMfaStatus = async (req, res) => {
  try {
    const user = req.user;
    const { deviceId } = getDeviceFingerprint(req);

    const recentSessions = await LoginSession.find({ userId: user._id, active: true })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({
      totpEnabled: user.totpEnabled || false,
      totpVerifiedAt: user.totpVerifiedAt || null,
      backupCodesRemaining: (user.totpBackupCodes || []).length,
      trustedDevicesCount: (user.trustedDeviceIds || []).length,
      currentDeviceTrusted: (user.trustedDeviceIds || []).includes(deviceId),
      emailVerified: user.emailVerified || false,
      lastLoginAt: user.lastLoginAt || null,
      lastLoginIp: user.lastLoginIp || "",
      recentSessions: recentSessions.map((s) => ({
        id: s._id,
        deviceName: s.deviceName,
        browser: s.browser,
        os: s.os,
        ip: s.ip,
        authMethod: s.authMethod,
        trusted: s.trusted,
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
        current: s.deviceId === deviceId,
      })),
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch MFA status." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE TRUST — Trust current device (skip 2FA)
// POST /api/users/mfa/trust-device
// ─────────────────────────────────────────────────────────────────────────────
const trustDevice = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { deviceId, deviceName } = getDeviceFingerprint(req);

    if (!user.trustedDeviceIds.includes(deviceId)) {
      user.trustedDeviceIds.push(deviceId);
    }
    await user.save({ validateBeforeSave: false });

    // Update session record
    await LoginSession.findOneAndUpdate(
      { userId: user._id, deviceId, active: true },
      { trusted: true, trustedAt: new Date() },
      { sort: { createdAt: -1 } }
    );

    res.json({ message: `${deviceName} is now trusted. You won't be prompted for 2FA on this device for 90 days.` });
  } catch (err) {
    res.status(500).json({ message: "Failed to trust device." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REVOKE DEVICE TRUST
// DELETE /api/users/mfa/trust-device/:deviceId
// ─────────────────────────────────────────────────────────────────────────────
const revokeDeviceTrust = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { deviceId } = req.params;

    user.trustedDeviceIds = user.trustedDeviceIds.filter((d) => d !== deviceId);
    await user.save({ validateBeforeSave: false });

    await LoginSession.updateMany(
      { userId: user._id, deviceId },
      { trusted: false, active: false, revokedAt: new Date() }
    );

    res.json({ message: "Device trust revoked. 2FA will be required from this device." });
  } catch (err) {
    res.status(500).json({ message: "Failed to revoke device trust." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REVOKE SESSION
// DELETE /api/users/mfa/sessions/:sessionId
// ─────────────────────────────────────────────────────────────────────────────
const revokeSession = async (req, res) => {
  try {
    const session = await LoginSession.findOne({
      _id: req.params.sessionId,
      userId: req.user._id,
    });

    if (!session) return res.status(404).json({ message: "Session not found." });

    session.active = false;
    session.revokedAt = new Date();
    await session.save();

    res.json({ message: "Session revoked successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to revoke session." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// REVOKE ALL OTHER SESSIONS
// DELETE /api/users/mfa/sessions
// ─────────────────────────────────────────────────────────────────────────────
const revokeAllOtherSessions = async (req, res) => {
  try {
    const { deviceId } = getDeviceFingerprint(req);

    await LoginSession.updateMany(
      { userId: req.user._id, deviceId: { $ne: deviceId }, active: true },
      { active: false, revokedAt: new Date() }
    );

    res.json({ message: "All other sessions signed out successfully." });
  } catch (err) {
    res.status(500).json({ message: "Failed to revoke sessions." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SEND SECURITY OTP — for new device verification or suspicious login
// POST /api/users/mfa/security-otp/send
// ─────────────────────────────────────────────────────────────────────────────
const sendSecurityOtp = async (req, res) => {
  try {
    const { email, type = "new_device" } = req.body;
    if (!email) return res.status(400).json({ message: "Email required." });

    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (!user) return res.status(404).json({ message: "User not found." });

    const otp = user.getSecurityOtp(type);
    await user.save({ validateBeforeSave: false });

    const { deviceName } = getDeviceFingerprint(req);
    const ip = getClientIp(req);

    const typeLabels = {
      new_device: "New Device Sign-In",
      suspicious_login: "Suspicious Login Alert",
      email_verify: "Email Verification",
    };

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:520px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Security Alert</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#f87171;font-weight:bold;">🔐 ${typeLabels[type] || "Security Verification"}</p>
    <p>Hi <strong>${user.name || "User"}</strong>,</p>
    <p>A sign-in was attempted from a <strong>new device or unusual location</strong>:</p>
    <table style="background:#0d1226;border:1px solid #2a3050;border-radius:8px;padding:16px;margin:16px 0;width:100%;border-collapse:collapse;">
      <tr><td style="color:#5a6478;font-size:12px;padding:4px 8px;">Device</td><td style="font-size:12px;padding:4px 8px;">${deviceName}</td></tr>
      <tr><td style="color:#5a6478;font-size:12px;padding:4px 8px;">IP Address</td><td style="font-size:12px;padding:4px 8px;">${ip}</td></tr>
      <tr><td style="color:#5a6478;font-size:12px;padding:4px 8px;">Time</td><td style="font-size:12px;padding:4px 8px;">${new Date().toUTCString()}</td></tr>
    </table>
    <p>Enter this code to verify it's you:</p>
    <div style="background:#0d1226;border:1px solid #6b8aff;border-radius:12px;padding:32px;margin:24px 0;text-align:center;">
      <div style="font-size:42px;font-weight:900;letter-spacing:12px;color:#6b8aff;font-family:monospace;">${otp}</div>
      <div style="font-size:11px;color:#5a6478;margin-top:8px;font-family:monospace;">Expires in 15 minutes</div>
    </div>
    <p style="color:#f87171;font-size:13px;"><strong>⚠ If this wasn't you:</strong> Change your password immediately and enable 2FA.</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof — Screen Everyone · Catch the Fraud · Prove the Honest</p>
  </div>
</body></html>`;

    await sendEmail({
      email: user.email,
      subject: `[VeriProof] Security Alert — ${typeLabels[type] || "Verification Required"}`,
      html,
    });

    res.json({ message: "Security verification code sent to your email.", expiresInMinutes: 15 });
  } catch (err) {
    console.error("[MFA] Security OTP send error:", err);
    res.status(500).json({ message: "Failed to send security code." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY SECURITY OTP
// POST /api/users/mfa/security-otp/verify  { email, otp, trustDevice }
// ─────────────────────────────────────────────────────────────────────────────
const verifySecurityOtp = async (req, res) => {
  try {
    const { email, otp, trustDevice } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and verification code are required." });
    }

    const hashedOtp = crypto.createHash("sha256").update(String(otp)).digest("hex");
    const user = await User.findOne({
      email: email.trim().toLowerCase(),
      securityOtpCode: hashedOtp,
      securityOtpExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired security code. Please request a new one." });
    }

    // Clear OTP
    user.securityOtpCode = undefined;
    user.securityOtpExpire = undefined;
    user.securityOtpType = "";

    const { deviceId, deviceName } = getDeviceFingerprint(req);
    const ip = getClientIp(req);

    if (trustDevice && deviceId) {
      if (!user.trustedDeviceIds.includes(deviceId)) {
        user.trustedDeviceIds.push(deviceId);
      }
    }

    user.recordSuccessfulLogin(ip, deviceId);
    await user.save({ validateBeforeSave: false });

    const generateToken = require("../utils/generateToken");

    res.json({
      success: true,
      token: generateToken(user._id),
      message: "Identity verified successfully.",
    });
  } catch (err) {
    console.error("[MFA] Security OTP verify error:", err);
    res.status(500).json({ message: "Security code verification failed." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SEND EMAIL VERIFICATION
// POST /api/users/mfa/verify-email/send
// ─────────────────────────────────────────────────────────────────────────────
const sendEmailVerification = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.emailVerified) {
      return res.json({ message: "Your email is already verified.", emailVerified: true });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.emailVerifyToken = crypto.createHash("sha256").update(token).digest("hex");
    user.emailVerifyExpire = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    await user.save({ validateBeforeSave: false });

    const verifyUrl = `${process.env.FRONTEND_URL || "https://veriproof.vercel.app"}/verify-email?token=${token}`;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:520px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;">Email Verification</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${user.name}</strong>,</p>
    <p>Please verify your email address to unlock all VeriProof features.</p>
    <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#6b8aff,#38bdf8);color:#000;font-weight:bold;font-size:14px;padding:14px 32px;border-radius:12px;text-decoration:none;margin:20px 0;">
      Verify My Email →
    </a>
    <p style="color:#5a6478;font-size:12px;">Link expires in 24 hours. If you did not create this account, ignore this email.</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof — Screen Everyone · Catch the Fraud · Prove the Honest</p>
  </div>
</body></html>`;

    await sendEmail({
      email: user.email,
      subject: "[VeriProof] Verify Your Email Address",
      html,
    });

    res.json({ message: "Verification email sent. Check your inbox." });
  } catch (err) {
    console.error("[MFA] Email verify send error:", err);
    res.status(500).json({ message: "Failed to send verification email." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRM EMAIL VERIFICATION (via link token)
// POST /api/users/mfa/verify-email/confirm  { token }
// ─────────────────────────────────────────────────────────────────────────────
const confirmEmailVerification = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Verification token required." });

    const hashed = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      emailVerifyToken: hashed,
      emailVerifyExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired verification link. Please request a new one." });
    }

    user.emailVerified = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyExpire = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({ message: "Email verified successfully.", emailVerified: true });
  } catch (err) {
    res.status(500).json({ message: "Email verification failed." });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper: reusable security alert email template
// ─────────────────────────────────────────────────────────────────────────────
const securityAlertEmail = (name, title, description, warning) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:520px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;">Security Alert</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${name}</strong>,</p>
    <div style="background:#0d1226;border-left:3px solid #6b8aff;padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0;">
      <p style="margin:0;font-weight:bold;color:#6b8aff;">${title}</p>
      <p style="margin:8px 0 0;font-size:13px;color:#94a0b8;">${description}</p>
    </div>
    <p style="color:#f87171;font-size:13px;">⚠ ${warning}</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof — Screen Everyone · Catch the Fraud · Prove the Honest</p>
  </div>
</body></html>`;

module.exports = {
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
};
