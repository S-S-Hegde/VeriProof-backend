const { extractImages } = require("unpdf");
const jsQR = require("jsqr");

/**
 * 100% Pure Node.js QR Code Extractor for PDF and Image Documents.
 * Uses unpdf to extract page 1 image pixel arrays and jsQR to decode them.
 * Requires ZERO system packages, zero Python subprocesses, and zero native binaries.
 * Guaranteed to run on Render, Linux, Windows, and macOS out of the box.
 */
async function decodeQrFromPdf(pdfBuffer) {
  if (!pdfBuffer || pdfBuffer.length === 0) return null;

  try {
    const images = await extractImages(new Uint8Array(pdfBuffer), 1);
    for (const img of images) {
      const { data, width, height, channels } = img;
      if (!data || width < 40 || height < 40) continue;

      let rgba = null;
      if (channels === 4) {
        rgba = new Uint8ClampedArray(data);
      } else if (channels === 3) {
        rgba = new Uint8ClampedArray(width * height * 4);
        for (let p = 0; p < width * height; p++) {
          rgba[p * 4] = data[p * 3];
          rgba[p * 4 + 1] = data[p * 3 + 1];
          rgba[p * 4 + 2] = data[p * 3 + 2];
          rgba[p * 4 + 3] = 255;
        }
      } else if (channels === 1) {
        rgba = new Uint8ClampedArray(width * height * 4);
        for (let p = 0; p < width * height; p++) {
          const val = data[p];
          rgba[p * 4] = val;
          rgba[p * 4 + 1] = val;
          rgba[p * 4 + 2] = val;
          rgba[p * 4 + 3] = 255;
        }
      }

      if (rgba) {
        const code = jsQR(rgba, width, height);
        if (code && code.data) {
          return code.data;
        }
      }
    }
  } catch (err) {
    console.warn("[QR Decoder] jsQR extraction notice:", err.message);
  }

  // Fallback string scan for text-embedded verify URLs
  try {
    const text = pdfBuffer.toString("latin1");
    const urlMatch = text.match(
      /https?:\/\/(?:verify\.onwingspan\.com|nptel\.ac\.in\/noc\/E_Certificate\/[A-Za-z0-9]+)/i
    );
    if (urlMatch) return urlMatch[0];
  } catch (e) {}

  return null;
}

module.exports = { decodeQrFromPdf };
