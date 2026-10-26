const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");
const {
  getMyCertificates,
  uploadCertificates,
  updateCertificateDetails,
  markManuallyConfirmed,
  getCertificateFile,
  deleteCertificate,
} = require("../controllers/certificateController");

const storage = multer.memoryStorage(); // Use memory storage for direct buffer hashing & GridFS storage

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

router.route("/:id/file").get(getCertificateFile);

router
  .route("/:id")
  .put(protect, updateCertificateDetails)
  .delete(protect, deleteCertificate);

router.route("/:id/manual-confirm").post(protect, markManuallyConfirmed);

module.exports = router;
