const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Robust QR Code Extractor for PDF Documents
 * Leverages python's pypdf + pyzbar/opencv to extract and decode QR codes from PDF page 1 images.
 */
function decodeQrFromPdf(pdfBuffer) {
  if (!pdfBuffer || pdfBuffer.length === 0) return null;

  // Write temporary PDF file
  const tmpPath = path.join(os.tmpdir(), `qr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.pdf`);
  try {
    fs.writeFileSync(tmpPath, pdfBuffer);

    // Call python script to extract QR code
    const pythonScript = `
import sys, json, io
from pypdf import PdfReader
from PIL import Image
try:
    from pyzbar.pyzbar import decode
except Exception:
    decode = None
import cv2, numpy as np

pdf_path = sys.argv[1]
result = {"url": None, "raw": None}
try:
    reader = PdfReader(pdf_path)
    if reader.pages:
        page = reader.pages[0]
        qr_detector = cv2.QRCodeDetector()
        for img_file in page.images:
            try:
                img = Image.open(io.BytesIO(img_file.data))
                if decode:
                    barcodes = decode(img)
                    if barcodes:
                        data = barcodes[0].data.decode('utf-8')
                        result["raw"] = data
                        break
                img_cv = cv2.cvtColor(np.array(img.convert('RGB')), cv2.COLOR_RGB2BGR)
                data, _, _ = qr_detector.detectAndDecode(img_cv)
                if data:
                    result["raw"] = data
                    break
            except Exception:
                continue
except Exception as e:
    result["error"] = str(e)

print(json.dumps(result))
`;

    const py = spawnSync("python", ["-c", pythonScript, tmpPath], {
      encoding: "utf-8",
      timeout: 10000,
    });

    if (py.stdout) {
      try {
        const out = JSON.parse(py.stdout.trim());
        if (out.raw) {
          // If the raw text is JSON or W3C VC, or a direct URL
          return out.raw;
        }
      } catch (e) {}
    }
  } catch (err) {
    console.warn("[QR Decoder] Extraction notice:", err.message);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (e) {}
  }

  // Fallback: Scan text buffer for verify URLs
  try {
    const text = pdfBuffer.toString("latin1");
    const urlMatch = text.match(/https?:\/\/(?:verify\.onwingspan\.com|nptel\.ac\.in\/noc\/E_Certificate\/[A-Za-z0-9]+)/i);
    if (urlMatch) return urlMatch[0];
  } catch (e) {}

  return null;
}

module.exports = { decodeQrFromPdf };
