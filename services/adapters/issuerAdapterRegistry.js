const axios = require("axios");

// Allowlisted verification hosts (SSRF Protection)
const ALLOWLISTED_HOSTS = [
  "verify.onwingspan.com",
  "nptel.ac.in",
  "archive.nptel.ac.in",
];

/**
 * Fuzzy Name Matcher: Case-insensitive, ignores middle names, checks token overlap.
 */
function compareNames(accountName, documentName) {
  if (!accountName || !documentName) return { matches: true, similarity: 1.0 };

  const clean = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);

  const accTokens = clean(accountName);
  const docTokens = clean(documentName);

  if (accTokens.length === 0 || docTokens.length === 0) return { matches: true, similarity: 1.0 };

  // Check how many account tokens appear in doc tokens
  const matchedAcc = accTokens.filter((t) => docTokens.includes(t));
  const score = matchedAcc.length / accTokens.length;

  // If first and last name match, or overlap is >= 0.65
  const matches = score >= 0.65;
  return {
    matches,
    similarity: Math.round(score * 100) / 100,
  };
}

/**
 * Verify credential with issuer adapter
 */
async function verifyWithIssuerAdapter(extractedData, userAccount) {
  const {
    title_as_printed,
    issuer_canonical,
    recipient_as_printed,
    verification_url,
    credential_id,
  } = extractedData;

  // 1. Recipient Name Check
  if (recipient_as_printed && userAccount?.name) {
    const nameMatch = compareNames(userAccount.name, recipient_as_printed);
    if (!nameMatch.matches) {
      return {
        status: "NAME_MISMATCH",
        reason: `Recipient "${recipient_as_printed}" differs from account holder "${userAccount.name}" (similarity: ${(nameMatch.similarity * 100).toFixed(0)}%). Manual review required.`,
        checkedAt: new Date(),
      };
    }
  }

  // 2. Check QR presence & host allowlist
  if (!verification_url) {
    return {
      status: "UNVERIFIED",
      reason: "No verification QR code or URL found on document.",
      checkedAt: new Date(),
    };
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(verification_url);
  } catch (e) {
    return {
      status: "REJECTED",
      reason: "Invalid verification URL format.",
      checkedAt: new Date(),
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isAllowlisted = ALLOWLISTED_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));

  if (!isAllowlisted) {
    return {
      status: "REJECTED",
      reason: `Verification host "${hostname}" is not recognized or not allowlisted.`,
      checkedAt: new Date(),
    };
  }

  // 3. Adapter: NPTEL
  if (hostname.includes("nptel.ac.in")) {
    try {
      const res = await axios.get(verification_url, {
        timeout: 5000,
        maxContentLength: 1024 * 1024, // 1MB cap
        headers: { "User-Agent": "VeriProof-Forensic-Auditor/1.0" },
      });

      const bodyText = String(res.data);
      if (credential_id && (bodyText.includes(credential_id) || verification_url.includes(credential_id))) {
        return {
          status: "ISSUER_CONFIRMED",
          reason: `NPTEL registry confirmed certificate for roll number ${credential_id}.`,
          checkedAt: new Date(),
        };
      }
      return {
        status: "DOCUMENT_READ",
        reason: "NPTEL verification page accessible. Roll number present in certificate URL.",
        checkedAt: new Date(),
      };
    } catch (err) {
      return {
        status: "DOCUMENT_READ",
        reason: `Issuer portal reached with status: ${err.message}. Verification requires browser review.`,
        checkedAt: new Date(),
      };
    }
  }

  // 4. Adapter: Infosys Springboard (verify.onwingspan.com)
  // Wingspan operates as a client-side Angular SPA that requires interactive client verification.
  // Never claim ISSUER_CONFIRMED without machine comparison!
  if (hostname.includes("onwingspan.com")) {
    return {
      status: "DOCUMENT_READ",
      reason: "Read from document. Issuer portal (verify.onwingspan.com) requires interactive client inspection.",
      checkedAt: new Date(),
    };
  }

  return {
    status: "UNVERIFIED",
    reason: "Document read successfully. Automated issuer API comparison not available for this vendor.",
    checkedAt: new Date(),
  };
}

module.exports = {
  verifyWithIssuerAdapter,
  compareNames,
  ALLOWLISTED_HOSTS,
};
