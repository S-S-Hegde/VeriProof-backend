const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { extractDocumentText } = require("./textExtractor");
const { decodeAllQrCodes } = require("./qrDecoder");
const { extractWithLlm } = require("./universalLlmExtractor");
const { applyGroundingGate } = require("./groundingGate");
const { runDeterministicPass } = require("./deterministicExtractor");
const { deriveSkillsFromTitle } = require("./skillDeriver");
const { validateMagicBytes } = require("../../utils/gridfsStorage");

// Load issuer aliases from JSON
let ISSUER_ALIASES = [];
try {
  const aliasPath = path.join(__dirname, "../../data/issuer_aliases.json");
  if (fs.existsSync(aliasPath)) {
    ISSUER_ALIASES = JSON.parse(fs.readFileSync(aliasPath, "utf-8"));
  }
} catch (e) {
  ISSUER_ALIASES = [];
}

// In-memory extraction cache by file_hash
const EXTRACTION_CACHE = new Map();

function deriveCanonicalIssuer(printedIssuer) {
  if (!printedIssuer || typeof printedIssuer !== "string") {
    return { value: null, domain: null };
  }

  const lower = printedIssuer.toLowerCase();
  for (const entry of ISSUER_ALIASES) {
    const regex = new RegExp(`\\b(?:${entry.pattern})\\b`, "i");
    if (regex.test(lower)) {
      return {
        value: entry.canonical_name,
        domain: entry.domain || null,
      };
    }
  }

  return {
    value: printedIssuer.trim(),
    domain: null,
  };
}

/**
 * Universal Certificate Extractor.
 * Identical code path for EVERY certificate document regardless of vendor.
 */
async function extractUniversalCertificate(buffer, mimeType = "application/pdf", fileName = "document.pdf") {
  // 1. File Validation
  if (!buffer || buffer.length === 0) {
    throw new Error("Empty document buffer provided");
  }

  const magicCheck = validateMagicBytes(buffer, mimeType);
  if (!magicCheck.valid) {
    throw new Error(`Invalid file format: ${magicCheck.reason}`);
  }

  // 2. SHA-256 Hash & Cache Check
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (EXTRACTION_CACHE.has(fileHash)) {
    return { ...EXTRACTION_CACHE.get(fileHash) };
  }

  // 3. Text Extraction (with OCR fallback for images or <80 chars)
  const textResult = await extractDocumentText(buffer, mimeType);
  const rawText = textResult.raw_text;

  // 4. QR and Barcode Decoding
  const qrPayloads = await decodeAllQrCodes(buffer, mimeType);

  // Collect verification URLs from QR payloads and raw text
  const verificationUrls = [];
  const seenUrls = new Set();

  for (const qr of qrPayloads) {
    if (qr.kind === "url") {
      if (!seenUrls.has(qr.raw)) {
        seenUrls.add(qr.raw);
        verificationUrls.push({ url: qr.raw, source: "qr", confidence: 1.0 });
      }
    }
  }

  const textUrls = rawText.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s<>"'{}|\\^`[\]]*)?/g) || [];
  for (const u of textUrls) {
    const cleanU = u.replace(/[\)\],>]+$/, "").replace(/\/+$/, "");
    if (!seenUrls.has(cleanU) && !cleanU.includes("w3.org") && !cleanU.includes("adobe.com")) {
      seenUrls.add(cleanU);
      verificationUrls.push({ url: cleanU, source: "text", confidence: 0.9 });
    }
  }

  // 5. LLM Structuring with Grounding Gate
  let structuredFields = null;
  let ungroundedList = [];
  let confidence = 0.95;

  const llmResult = await extractWithLlm(rawText);
  if (llmResult) {
    const groundedResult = applyGroundingGate(llmResult, rawText);
    structuredFields = groundedResult.grounded;
    ungroundedList = groundedResult.ungroundedFields;
  }

  // 6. Deterministic Cross-checks & Fallback
  const deterministicFields = runDeterministicPass(rawText, qrPayloads);

  if (!structuredFields) {
    // LLM unavailable or failed: fall back to deterministic pass
    structuredFields = deterministicFields;
    confidence = 0.7;
  } else {
    // Reconcile: If LLM left key fields null but deterministic caught them with evidence, fill them
    if (!structuredFields.document_type?.value && deterministicFields.document_type?.value) {
      structuredFields.document_type = deterministicFields.document_type;
    }
    if (!structuredFields.title?.value && deterministicFields.title?.value) {
      structuredFields.title = deterministicFields.title;
    }
    if (!structuredFields.recipient_name?.value && deterministicFields.recipient_name?.value) {
      structuredFields.recipient_name = deterministicFields.recipient_name;
    }
    if (!structuredFields.issuer_as_printed?.value && deterministicFields.issuer_as_printed?.value) {
      structuredFields.issuer_as_printed = deterministicFields.issuer_as_printed;
    }
    if (!structuredFields.issue_date?.value && deterministicFields.issue_date?.value) {
      structuredFields.issue_date = deterministicFields.issue_date;
    }
    if (!structuredFields.period_or_session?.value && deterministicFields.period_or_session?.value) {
      structuredFields.period_or_session = deterministicFields.period_or_session;
    }
    if ((!structuredFields.identifiers || structuredFields.identifiers.length === 0) && deterministicFields.identifiers.length > 0) {
      structuredFields.identifiers = deterministicFields.identifiers;
    }
    if ((!structuredFields.scores || structuredFields.scores.length === 0) && deterministicFields.scores.length > 0) {
      structuredFields.scores = deterministicFields.scores;
    }
    if ((!structuredFields.extras || structuredFields.extras.length === 0) && deterministicFields.extras.length > 0) {
      structuredFields.extras = deterministicFields.extras;
    }
    if (!structuredFields.credits?.value && deterministicFields.credits?.value) {
      structuredFields.credits = deterministicFields.credits;
    }
    if ((!structuredFields.signatories || structuredFields.signatories.length === 0) && deterministicFields.signatories.length > 0) {
      structuredFields.signatories = deterministicFields.signatories;
    }
  }

  // 7. Canonical Issuer Derivation
  const printedIssuerStr = structuredFields.issuer_as_printed?.value || "";
  const canonicalDerivation = deriveCanonicalIssuer(printedIssuerStr);
  structuredFields.issuer_canonical = {
    value: canonicalDerivation.value,
    domain: canonicalDerivation.domain,
    source: "derived",
    confidence: 1.0,
  };

  // 8. Skill derivation from title
  const titleVal = structuredFields.title?.value || "";
  const skills = deriveSkillsFromTitle(titleVal);

  // 9. Overall Confidence Adjustment
  if (ungroundedList.length > 0) {
    confidence = Math.max(0.4, confidence - ungroundedList.length * 0.1);
  }

  const result = {
    document_type: structuredFields.document_type || { value: "other", evidence_quote: null, source: "text", confidence: 0.5 },
    title: structuredFields.title || { value: null, evidence_quote: null, source: "text", confidence: 0 },
    issuer_as_printed: structuredFields.issuer_as_printed || { value: null, evidence_quote: null, source: "text", confidence: 0 },
    issuer_canonical: structuredFields.issuer_canonical,
    recipient_name: structuredFields.recipient_name || { value: null, evidence_quote: null, source: "text", confidence: 0 },
    issue_date: structuredFields.issue_date || { value: null, evidence_quote: null, source: "text", confidence: 0 },
    expiry_date: structuredFields.expiry_date || { value: null, evidence_quote: null, source: "text", confidence: 0 },
    period_or_session: structuredFields.period_or_session || { value: null, evidence_quote: null, source: "text", confidence: 0 },
    duration_hours: structuredFields.duration_hours || { value: null, evidence_quote: null, source: "text", confidence: 0 },
    credits: structuredFields.credits || { value: null, evidence_quote: null, source: "text", confidence: 0 },
    grade_or_level: structuredFields.grade_or_level || { value: null, evidence_quote: null, source: "text", confidence: 0 },
    identifiers: structuredFields.identifiers || [],
    scores: structuredFields.scores || [],
    signatories: structuredFields.signatories || [],
    extras: structuredFields.extras || [],
    verification_urls: verificationUrls,
    qr_payloads: qrPayloads,
    skills: skills,
    language: "en",
    page_count: textResult.page_count,
    pdf_metadata: textResult.pdf_metadata,
    extraction_method: textResult.extraction_method,
    extraction_confidence: parseFloat(confidence.toFixed(2)),
    raw_text: rawText,
    file_hash: fileHash,
    ungrounded_fields: ungroundedList,
  };

  // Cache by hash
  EXTRACTION_CACHE.set(fileHash, result);

  return result;
}

module.exports = {
  extractUniversalCertificate,
  deriveCanonicalIssuer,
};
