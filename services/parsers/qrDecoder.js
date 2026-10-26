const { extractImages } = require("unpdf");
const jsQR = require("jsqr");

/**
 * Classifies a raw payload into its detected credential kind:
 * url | w3c_vc | open_badge | jwt | text
 */
function classifyPayload(raw) {
  if (!raw || typeof raw !== "string") return "text";
  const trimmed = raw.trim();

  // 1. URL
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
    return "url";
  }

  // 2. JWT (Header.Payload.Signature)
  if (/^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(trimmed)) {
    return "jwt";
  }

  // 3. JSON structures
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj.proof || (Array.isArray(obj.type) && obj.type.includes("VerifiableCredential"))) {
        return "w3c_vc";
      }
      if (obj.badge || obj.recipient || obj["@context"]?.toString().includes("openbadges")) {
        return "open_badge";
      }
      return "json";
    } catch (e) {
      // not valid JSON
    }
  }

  return "text";
}

/**
 * Extracts and decodes all QR codes from a PDF buffer or image buffer.
 * Pure Node.js runtime using unpdf + jsQR.
 * Returns array of { raw, kind }
 */
async function decodeAllQrCodes(buffer, mimeType = "application/pdf") {
  if (!buffer || buffer.length === 0) return [];
  const results = [];
  const seenRaw = new Set();

  try {
    if (mimeType === "application/pdf") {
      const images = await extractImages(new Uint8Array(buffer), 1);
      for (const img of images) {
        const { data, width, height, channels } = img;
        if (!data || width < 30 || height < 30) continue;

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
          if (code && code.data && !seenRaw.has(code.data)) {
            seenRaw.add(code.data);
            results.push({
              raw: code.data,
              kind: classifyPayload(code.data),
            });
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal extraction notice
  }

  // Generic fallback: raw binary stream regex scan for verification URLs
  try {
    const rawString = buffer.toString("latin1");
    const matches = rawString.match(/https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s<>"'{}|\\^`[\]]*)?/g) || [];
    for (const url of matches) {
      const cleanUrl = url.replace(/[\)\],>]+$/, "").replace(/\/+$/, "");
      // Filter out XML namespaces / schemas
      if (!cleanUrl.includes("w3.org") && !cleanUrl.includes("adobe.com") && !seenRaw.has(cleanUrl)) {
        seenRaw.add(cleanUrl);
        results.push({
          raw: cleanUrl,
          kind: "url",
        });
      }
    }
  } catch (e) {}

  return results;
}

module.exports = {
  decodeAllQrCodes,
  classifyPayload,
};
