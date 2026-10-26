const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const psl = require("psl");

let TRUSTED_VERIFIERS = [];
try {
  const filePath = path.join(__dirname, "../../data/trusted_verifiers.json");
  if (fs.existsSync(filePath)) {
    TRUSTED_VERIFIERS = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }
} catch (e) {
  TRUSTED_VERIFIERS = [];
}

const SHARED_HOSTS = new Set([
  "github.io",
  "vercel.app",
  "netlify.app",
  "blogspot.com",
  "wixsite.com",
  "drive.google.com",
  "dropbox.com",
  "pages.dev",
  "firebaseapp.com",
  "render.com",
  "onrender.com",
]);

function isSharedHost(hostname) {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  for (const s of SHARED_HOSTS) {
    if (lower === s || lower.endsWith("." + s)) return true;
  }
  return false;
}

/**
 * Checks if an IP string is private/internal/loopback (SSRF protection).
 */
function isPrivateIp(ip) {
  if (!ip) return true;
  // IPv4 Loopback
  if (/^127\./.test(ip)) return true;
  // IPv4 Private
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  // Link local / APIPA
  if (/^169\.254\./.test(ip)) return true;
  // IPv6 Loopback / Private
  if (ip === "::1" || /^fe80:/i.test(ip) || /^fc00:/i.test(ip) || /^fd00:/i.test(ip)) return true;

  return false;
}

/**
 * Validates whether a URL is SSRF-safe and checks its host against the trust model.
 * Returns { isTrusted, isSsrfSafe, host, registeredDomain, verifierEntry, reason }
 */
async function evaluateHostTrust(targetUrl, documentIssuerDomain = null) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (err) {
    return {
      isTrusted: false,
      isSsrfSafe: false,
      reason: "Invalid URL format",
    };
  }

  // 1. Must be HTTPS
  if (parsed.protocol !== "https:") {
    return {
      isTrusted: false,
      isSsrfSafe: false,
      reason: "Insecure protocol (must be HTTPS)",
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. SSRF Check: DNS resolution check
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return {
      isTrusted: false,
      isSsrfSafe: false,
      host: hostname,
      reason: "Blocked internal/loopback host (SSRF)",
    };
  }

  try {
    const lookup = await dns.lookup(hostname);
    if (isPrivateIp(lookup.address)) {
      return {
        isTrusted: false,
        isSsrfSafe: false,
        host: hostname,
        reason: `Host resolves to private IP (${lookup.address}) (SSRF)`,
      };
    }
  } catch (dnsErr) {
    return {
      isTrusted: false,
      isSsrfSafe: false,
      host: hostname,
      reason: `DNS lookup failed for ${hostname}`,
    };
  }

  // 3. Extract registered domain using PSL
  const parsedDomain = psl.parse(hostname);
  const registeredDomain = parsedDomain.domain || hostname;

  // 4. Check trusted_verifiers.json
  const entry = TRUSTED_VERIFIERS.find(
    (tv) => tv.host === hostname || tv.registered_domain === registeredDomain
  );

  if (entry && entry.trusted) {
    return {
      isTrusted: true,
      isSsrfSafe: true,
      host: hostname,
      registeredDomain,
      verifierEntry: entry,
      reason: "Host is in trusted verifiers registry",
    };
  }

  // 5. Shared hosting platforms are NEVER trusted for auto-confirmation
  if (isSharedHost(hostname) || isSharedHost(registeredDomain)) {
    return {
      isTrusted: false,
      isSsrfSafe: true,
      host: hostname,
      registeredDomain,
      reason: `Verification host is a shared hosting platform (${hostname})`,
    };
  }

  // 6. Host not in registry: check if equals document issuer domain
  if (documentIssuerDomain) {
    const docParsed = psl.parse(documentIssuerDomain.toLowerCase());
    const docRegistered = docParsed.domain || documentIssuerDomain.toLowerCase();

    if (registeredDomain === docRegistered) {
      return {
        isTrusted: true,
        isSsrfSafe: true,
        host: hostname,
        registeredDomain,
        verifierEntry: null,
        reason: "Host matches document issuer's authoritative domain",
      };
    }
  }

  return {
    isTrusted: false,
    isSsrfSafe: true,
    host: hostname,
    registeredDomain,
    reason: `verification link points to an unlisted domain (${hostname})`,
  };
}

module.exports = {
  evaluateHostTrust,
  isPrivateIp,
};
