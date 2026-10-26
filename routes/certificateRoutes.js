const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");
const {
  getMyCertificates,
  uploadCertificates,
  reanalyzeAllCertificates,
  getCertificateFile,
  deleteCertificate,
} = require("../controllers/certificateController");

// Ensure certificate uploads folder exists
const certUploadDir = path.join(__dirname, "../uploads/certificates");
if (!fs.existsSync(certUploadDir)) {
  fs.mkdirSync(certUploadDir, { recursive: true });
}

const storage = multer.memoryStorage(); // Use memory storage for direct buffer hashing & database preservation

const certUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max per file
  fileFilter: (req, file, cb) => {
    const allowedExts = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (
      allowedExts.includes(ext) ||
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only certificate files (PDF, PNG, JPG, WEBP) are allowed."), false);
    }
  },
});

router
  .route("/")
  .get(protect, getMyCertificates)
  .post(protect, certUpload.array("certificates", 10), uploadCertificates);

router.route("/re-analyze-all").post(protect, reanalyzeAllCertificates);

router.route("/:id/file").get(getCertificateFile);

router.route("/:id").delete(protect, deleteCertificate);

module.exports = router;
