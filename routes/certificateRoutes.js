const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");
const {
  getMyCertificates,
  createCertificate,
  deleteCertificate,
} = require("../controllers/certificateController");

// Ensure certificate uploads folder exists
const certUploadDir = path.join(__dirname, "../uploads/certificates");
if (!fs.existsSync(certUploadDir)) {
  fs.mkdirSync(certUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, certUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".pdf";
    const uniqueSuffix = crypto.randomBytes(12).toString("hex");
    cb(null, `cert_${uniqueSuffix}${ext}`);
  },
});

const certUpload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
  fileFilter: (req, file, cb) => {
    const allowedExts = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (allowedExts.includes(ext) || file.mimetype.startsWith("image/") || file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only certificate files (PDF, PNG, JPG, WEBP) are allowed."), false);
    }
  },
});

router.route("/")
  .get(protect, getMyCertificates)
  .post(protect, certUpload.single("certificate"), createCertificate);

router.route("/:id")
  .delete(protect, deleteCertificate);

module.exports = router;
