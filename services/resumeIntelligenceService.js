const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const User = require("../models/User");
const ResumeAnalysis = require("../models/ResumeAnalysis");

const PYTHON_API_BASE = "http://127.0.0.1:8000/api";

// Helper: download file from URL (local or Cloudinary)
const downloadFile = async (fileUrl) => {
  if (fileUrl.startsWith("/uploads/")) {
    const localPath = path.join(__dirname, "..", fileUrl);
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }
    return fs.readFileSync(localPath);
  }

  const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
};

// Proxies the buffer directly to the Python FastAPI microservice
const analyzeResumeBuffer = async (
  buffer,
  { mimeType, fileName, userProfile = {} } = {},
) => {
  const form = new FormData();
  form.append("file", buffer, {
    filename: fileName || "resume.pdf",
    contentType: mimeType || "application/pdf",
  });

  try {
    const response = await axios.post(
      `${PYTHON_API_BASE}/extract-claims-pdf`,
      form,
      {
        headers: {
          ...form.getHeaders(),
        },
      },
    );

    const pythonData = response.data;

    if (pythonData.status === "error") {
      throw new Error(pythonData.error?.message || "Python extraction failed");
    }

    // Format the response to match the old expected schema for compatibility
    return {
      normalizedText:
        pythonData.result.extracted_text_preview ||
        "Text processed by Python Engine",
      claims: {
        skills: pythonData.result.claims || [],
        projects: [],
        certifications: [],
        education: [],
        experience: [],
        contactInfo: {
          fullName: userProfile.name || "",
          email: "",
          phone: "",
          githubUrl: "",
          linkedinUrl: "",
        },
      },
      analysis: {
        missingFields: [],
        parsingConfidence: 99,
        resumeCompleteness: 100,
        parseErrors: [],
      },
    };
  } catch (error) {
    console.error("[Python Proxy Error]:", error.message);
    throw new Error("Failed to communicate with Python AI Engine.");
  }
};

// Main Asynchronous orchestrator for Student Resume Uploads
const runAnalysis = async (userId, resumeUrl, fileMetadata = {}) => {
  let analysisRecord = null;
  try {
    console.log(
      `[Resume Intelligence] Forwarding parse request to Python for User ${userId}`,
    );

    await ResumeAnalysis.updateMany({ candidateId: userId }, { active: false });

    analysisRecord = await ResumeAnalysis.create({
      candidateId: userId,
      status: "Queued",
      progress: 25,
      stage: "Forwarding to AI Engine",
      estimatedRemainingStage: "15s",
      active: true,
      resumeUrl,
      originalFileName: fileMetadata.originalFileName || "",
      mimeType: fileMetadata.mimeType || "application/pdf",
      processedAt: new Date(),
    });

    const user = await User.findById(userId);
    if (!user) throw new Error("Candidate user record not found");

    // ── STAGE 1: FETCH & PROXY TO PYTHON (50%) ──
    analysisRecord.status = "Extracting Information";
    analysisRecord.progress = 50;
    analysisRecord.stage = "AI Engine is extracting claims...";
    await analysisRecord.save();

    const buffer = await downloadFile(resumeUrl);
    const parseResult = await analyzeResumeBuffer(buffer, {
      mimeType: fileMetadata.mimeType,
      fileName: fileMetadata.originalFileName,
      userProfile: user,
    });

    // ── STAGE 2: SAVING RESULTS (80%) ──
    analysisRecord.status = "Updating Skill Tree";
    analysisRecord.progress = 80;
    analysisRecord.stage = "Saving verified claims";
    analysisRecord.truncatedText = parseResult.normalizedText;
    analysisRecord.claims = parseResult.claims;
    analysisRecord.analysis = parseResult.analysis;
    analysisRecord.processedAt = new Date();
    await analysisRecord.save();

    user.resumeStatus = "Analyzed";
    await user.save();

    // ── STAGE 3: COMPLETE (100%) ──
    analysisRecord.status = "Analysis Complete";
    analysisRecord.progress = 100;
    analysisRecord.stage = "Resume analysis complete.";
    analysisRecord.estimatedRemainingStage = "0s";
    await analysisRecord.save();

    console.log(
      `[Resume Intelligence] Analysis completed via Python for candidate: ${userId}`,
    );
  } catch (error) {
    console.error(
      `[Resume Intelligence] Analysis failed for candidate: ${userId}`,
      error,
    );
    if (analysisRecord) {
      analysisRecord.status = "Analysis Failed";
      analysisRecord.progress = 100;
      analysisRecord.stage = "Analysis failed due to engine error";
      analysisRecord.error = error.message;
      await analysisRecord.save();
    }
    try {
      const user = await User.findById(userId);
      if (user) {
        user.resumeStatus = "Rejected";
        await user.save();
      }
    } catch (e) {
      console.error("[Resume Intelligence] Reset status failure:", e);
    }
  }
};

module.exports = {
  runAnalysis,
  analyzeResumeBuffer,
};
