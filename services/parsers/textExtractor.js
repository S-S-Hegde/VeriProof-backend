const pdfParse = require("pdf-parse");
const { extractText } = require("unpdf");
const Tesseract = require("tesseract.js");

/**
 * Universal Text Extractor.
 * Extracts text and metadata from PDF or image documents.
 * Runs pdf-parse first; falls back to unpdf for modern/synthetic streams; falls back to OCR for images.
 */
async function extractDocumentText(buffer, mimeType = "application/pdf") {
  let rawText = "";
  let pageCount = 1;
  let metadata = {};
  let method = "text";

  const isImage = mimeType.startsWith("image/");

  if (!isImage && mimeType === "application/pdf") {
    // 1. Run pdf-parse
    try {
      const parsed = await pdfParse(buffer);
      rawText = parsed.text || "";
      pageCount = parsed.numpages || 1;
      metadata = {
        producer: parsed.info?.Producer || null,
        creator: parsed.info?.Creator || null,
        created: parsed.info?.CreationDate || null,
        modified: parsed.info?.ModDate || null,
      };
    } catch (err) {}

    // 2. If pdf-parse failed or returned fewer than 20 chars, try unpdf
    if (!rawText || rawText.trim().length < 20) {
      try {
        const unpdfRes = await extractText(new Uint8Array(buffer));
        if (unpdfRes && Array.isArray(unpdfRes.text) && unpdfRes.text.length > 0) {
          rawText = unpdfRes.text.join("\n").trim();
          pageCount = unpdfRes.totalPages || unpdfRes.text.length || pageCount;
        }
      } catch (e) {}
    }
  }

  // Count meaningful characters (non-whitespace)
  const meaningfulChars = (rawText.replace(/\s+/g, "")).length;

  if (isImage) {
    try {
      method = "ocr";
      const { data } = await Tesseract.recognize(buffer, "eng");
      if (data && data.text) {
        rawText = (rawText ? rawText + "\n" : "") + data.text;
      }
    } catch (ocrErr) {
      if (!rawText) {
        rawText = "";
      }
    }
  } else if (meaningfulChars < 80) {
    method = "fallback";
  }

  return {
    raw_text: rawText.trim(),
    page_count: pageCount,
    pdf_metadata: metadata,
    extraction_method: method,
  };
}

module.exports = { extractDocumentText };
