const express = require("express");
const router = express.Router();
const {
  parseResume,
  getExamForJob,
  submitExam,
  getRecruiterResults,
  getCandidateResults,
  createJobRole,
  getMyJobs,
  createJobFromFile,
  uploadApplicantResumes,
  getApplicantResumes,
  deleteJob,
  deleteApplicant,
  runFullVerificationPipeline,
  sendDailyDigest,
  updateShortlistRank,
} = require("../controllers/verifyController");

const { protect, recruiterOnly } = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 150 }, // 50MB payload limit, up to 150 files per batch
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = new Set([
      ".pdf", ".docx", ".doc", ".txt",
      ".csv", ".xlsx", ".xls", ".json", ".zip"
    ]);
    const allowedMimeTypes = new Set([
      "application/pdf",
      "application/x-pdf",
      "application/acrobat",
      "application/vnd.pdf",
      "text/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
      "text/csv",
      "application/csv",
      "text/x-csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/json",
      "application/zip",
      "application/x-zip-compressed",
      "application/octet-stream",
    ]);
    if (allowedMimeTypes.has(file.mimetype) || allowedExts.has(ext)) {
      return cb(null, true);
    }
    return cb(new Error("Supported file formats: PDF, DOCX, TXT, CSV, Excel (XLSX/XLS), JSON, ZIP archives."));
  },
});

const receiveDocuments = (field, maxCount) => (req, res, next) => {
  const middleware = maxCount > 1 ? documentUpload.array(field, maxCount) : documentUpload.single(field);
  middleware(req, res, (error) => {
    if (!error) {
      const files = req.files || (req.file ? [req.file] : []);
      const valid = files.every((file) => {
        if (!file || !file.buffer) return false;
        const ext = path.extname(file.originalname || "").toLowerCase();
        const isPdf = file.mimetype?.includes("pdf") || ext === ".pdf";
        const isDocx = file.mimetype?.includes("wordprocessingml") || file.mimetype?.includes("msword") || ext === ".docx" || ext === ".doc";
        const isZip = file.mimetype?.includes("zip") || ext === ".zip";

        if (isPdf) {
          // According to PDF spec, %PDF- header occurs within the first 1024 bytes
          const headerStr = file.buffer.subarray(0, 1024).toString("latin1");
          return headerStr.includes("%PDF-") || file.buffer.length > 50;
        }
        if (isDocx || isZip) {
          return file.buffer.length >= 4 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
        }
        return true;
      });
      if (!valid) return res.status(400).json({ message: "One or more files do not match their declared format." });
      return next();
    }
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({ message: error.message });
  });
};

// Recruiter endpoints
router.post("/parse",              protect, recruiterOnly, parseResume);
router.get("/results",             protect, recruiterOnly, getRecruiterResults);
router.post("/job",                protect, recruiterOnly, createJobRole);
router.post("/job/from-file",      protect, recruiterOnly, receiveDocuments("jobDescription", 1), createJobFromFile);
router.delete("/job/:id",          protect, recruiterOnly, deleteJob);
router.get("/my-jobs",             protect, recruiterOnly, getMyJobs);
router.post("/applicants/upload",  protect, recruiterOnly, receiveDocuments("resumes", 150), uploadApplicantResumes);
router.get("/applicants",          protect, recruiterOnly, getApplicantResumes);
router.put("/applicants/shortlist", protect, recruiterOnly, updateShortlistRank);
router.delete("/applicants/:id",   protect, recruiterOnly, deleteApplicant);
router.post("/daily-digest",       protect, recruiterOnly, sendDailyDigest);



// Candidate endpoints
router.get("/my-results", protect, getCandidateResults);
router.get("/exam/:jobId", protect, getExamForJob);
router.post("/exam/:resultId", protect, submitExam);

// Module 12 Master Endpoint (V2 Orchestrator)
router.post("/candidate/:candidateId", protect, recruiterOnly, runFullVerificationPipeline);

module.exports = router;
