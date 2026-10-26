const pdfParse = require("pdf-parse");
const { parseInfosysSpringboard } = require("./infosysSpringboardParser");
const { parseNptel } = require("./nptelParser");
const { parseGenericWithLlm } = require("./genericLlmParser");
const { decodeQrFromPdf } = require("./qrDecoder");

const DETERMINISTIC_PARSERS = [
  { name: "InfosysSpringboard", parse: parseInfosysSpringboard },
  { name: "NPTEL", parse: parseNptel },
];

/**
 * Universal Registry-Driven Document Extractor.
 * Runs deterministic per-issuer parsers first.
 * If none match, runs generic OCR/LLM with anti-hallucination verification.
 */
async function parseCertificateDocument(buffer, mimeType = "application/pdf", originalFilename = "") {
  let rawText = "";

  if (mimeType.includes("pdf") || (buffer.length > 5 && buffer.subarray(0, 5).toString("latin1").includes("%PDF"))) {
    try {
      const data = await pdfParse(buffer);
      rawText = data.text || "";
    } catch (e) {
      console.warn("[Parser Registry] pdf-parse warning:", e.message);
    }
  }

  // Extract QR payload / URL
  const qrData = await decodeQrFromPdf(buffer);

  // 1. Run deterministic per-issuer parsers
  for (const parser of DETERMINISTIC_PARSERS) {
    const result = parser.parse(rawText, qrData);
    if (result && result.matched) {
      result.raw_text = rawText.substring(0, 4000);
      return result;
    }
  }

  // 2. Generic fallback
  const genericResult = await parseGenericWithLlm(rawText, qrData);
  genericResult.raw_text = rawText.substring(0, 4000);
  return genericResult;
}

module.exports = {
  parseCertificateDocument,
  DETERMINISTIC_PARSERS,
};
