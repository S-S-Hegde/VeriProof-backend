const mongoose = require("mongoose");
const crypto = require("crypto");
const { ALLOWED_MAGIC_BYTES } = require("../config/certificateScoringConfig");

const BUCKET_NAME = "certificate_proofs";

/**
 * Validates file magic bytes against allowed binary headers.
 */
function validateMagicBytes(buffer) {
  if (!buffer || buffer.length < 4) return { valid: false, error: "File payload is empty or too short." };

  for (const entry of ALLOWED_MAGIC_BYTES) {
    let matches = true;
    for (let i = 0; i < entry.magic.length; i++) {
      if (buffer[i] !== entry.magic[i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return { valid: true, mimeType: entry.type, ext: entry.ext };
    }
  }

  return {
    valid: false,
    error: "Invalid file format or corrupted document header. Only valid PDF, PNG, JPG, and WEBP documents are allowed.",
  };
}

/**
 * Saves a file buffer directly to MongoDB GridFS.
 */
function saveFileToGridFS(buffer, filename, contentType = "application/pdf", metadata = {}) {
  return new Promise((resolve, reject) => {
    if (!mongoose.connection.db) {
      return reject(new Error("Database connection not ready for GridFS."));
    }

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: BUCKET_NAME,
    });

    const uploadStream = bucket.openUploadStream(filename, {
      contentType,
      metadata,
    });

    uploadStream.on("error", (err) => reject(err));
    uploadStream.on("finish", (fileDoc) => {
      resolve({
        gridfs_id: fileDoc._id,
        filename: fileDoc.filename,
        length: fileDoc.length,
        uploadDate: fileDoc.uploadDate,
      });
    });

    uploadStream.end(buffer);
  });
}

/**
 * Opens a download stream from GridFS by file ID.
 */
function getFileStreamFromGridFS(gridfsId) {
  if (!mongoose.connection.db) {
    throw new Error("Database connection not ready for GridFS.");
  }

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: BUCKET_NAME,
  });

  const objId = typeof gridfsId === "string" ? new mongoose.Types.ObjectId(gridfsId) : gridfsId;
  return bucket.openDownloadStream(objId);
}

/**
 * Deletes a file from GridFS.
 */
async function deleteFileFromGridFS(gridfsId) {
  if (!mongoose.connection.db || !gridfsId) return;

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: BUCKET_NAME,
  });

  const objId = typeof gridfsId === "string" ? new mongoose.Types.ObjectId(gridfsId) : gridfsId;
  try {
    await bucket.delete(objId);
  } catch (err) {
    console.warn("[GridFS] Delete warning:", err.message);
  }
}

/**
 * Generates a signed, short-lived download token (15-minute validity)
 */
function generateSignedProofToken(certificateId, userId) {
  const secret = process.env.JWT_SECRET || "veriproof-proof-signing-secret";
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes
  const payload = `${certificateId}:${userId}:${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${expiresAt}.${signature}`;
}

/**
 * Validates a signed short-lived download token
 */
function verifySignedProofToken(certificateId, userId, token) {
  if (!token || !token.includes(".")) return false;
  const [expiresAtStr, signature] = token.split(".");
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

  const secret = process.env.JWT_SECRET || "veriproof-proof-signing-secret";
  const payload = `${certificateId}:${userId}:${expiresAt}`;
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

module.exports = {
  BUCKET_NAME,
  validateMagicBytes,
  saveFileToGridFS,
  getFileStreamFromGridFS,
  deleteFileFromGridFS,
  generateSignedProofToken,
  verifySignedProofToken,
};
