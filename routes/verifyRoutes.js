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
} = require("../controllers/verifyController");

const { protect, recruiterOnly } = require("../middleware/authMiddleware");
const multer = require("multer");

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ]);
    cb(allowed.has(file.mimetype) ? null : new Error("Only PDF, DOCX, and TXT files are supported."), allowed.has(file.mimetype));
  },
});

const receiveDocuments = (field, maxCount) => (req, res, next) => {
  const middleware = maxCount > 1 ? documentUpload.array(field, maxCount) : documentUpload.single(field);
  middleware(req, res, (error) => {
    if (!error) {
      const files = req.files || (req.file ? [req.file] : []);
      const valid = files.every((file) => {
        if (file.mimetype === "application/pdf") return file.buffer.subarray(0, 5).toString() === "%PDF-";
        if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
        if (file.mimetype === "text/plain") return !file.buffer.includes(0x00);
        return false;
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
router.post("/applicants/upload",  protect, recruiterOnly, receiveDocuments("resumes", 10), uploadApplicantResumes);
router.get("/applicants",          protect, recruiterOnly, getApplicantResumes);
router.delete("/applicants/:id",   protect, recruiterOnly, deleteApplicant);



// Candidate endpoints
router.get("/my-results", protect, getCandidateResults);
router.get("/exam/:jobId", protect, getExamForJob);
router.post("/exam/:resultId", protect, submitExam);

// Module 12 Master Endpoint (V2 Orchestrator)
router.post("/candidate/:candidateId", protect, recruiterOnly, runFullVerificationPipeline);

module.exports = router;
