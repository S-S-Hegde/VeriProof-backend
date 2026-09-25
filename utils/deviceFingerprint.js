/**
 * deviceFingerprint.js
 *
 * Derives a deterministic device fingerprint from request headers.
 * Used for:
 *   - "Remember this device" trust management
 *   - Suspicious login / new device detection
 *   - Login session tracking
 */

const crypto = require("crypto");
const UAParser = require("ua-parser-js");

/**
 * Parse User-Agent into human-readable device info.
 */
const parseUserAgent = (uaString = "") => {
  const parser = new UAParser(uaString);
  const result = parser.getResult();

  const browser = result.browser.name || "Unknown Browser";
  const browserVersion = result.browser.major || "";
  const os = result.os.name || "Unknown OS";
  const device = result.device.type || "desktop"; // mobile | tablet | desktop

  return {
    browser: browserVersion ? `${browser} ${browserVersion}` : browser,
    os,
    deviceType: device,
    deviceName: `${browser} on ${os}`,
  };
};

/**
 * Generate a SHA-256 fingerprint for the device.
 * Stable across same browser/OS but changes if user switches browser or OS.
 */
const getDeviceFingerprint = (req) => {
  const ua = req.headers["user-agent"] || "";
  const acceptLang = req.headers["accept-language"] || "";
  const parsed = parseUserAgent(ua);

  // Combine stable signals: browser + OS + accept-language
  const raw = [
    parsed.browser,
    parsed.os,
    acceptLang.split(",")[0]?.trim() || "", // primary language only
  ].join("|");

  const fingerprint = crypto.createHash("sha256").update(raw).digest("hex");
  return {
    deviceId: fingerprint,
    ...parsed,
  };
};

/**
 * Extract the real IP from request (handles proxies, Render, Vercel).
 */
const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return (
    req.headers["x-real-ip"] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    ""
  );
};

module.exports = { getDeviceFingerprint, getClientIp, parseUserAgent };
