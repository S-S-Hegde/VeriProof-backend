const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/skillproof";
const API_BASE = "http://localhost:5000/api";

const evidenceLog = {
  timestamp: new Date().toISOString(),
  httpRequests: [],
  mongoSnapshots: {
    beforeExam: {},
    afterExam: {},
    diffs: {},
  },
  aiModuleInvocations: [],
  dashboardSyncState: {},
};

function recordHttp(method, url, status, duration, responseData) {
  evidenceLog.httpRequests.push({
    timestamp: new Date().toISOString(),
    method,
    url,
    status,
    durationMs: duration,
    responseData: JSON.parse(JSON.stringify(responseData)),
  });
}

async function runEvidenceCollection() {
  console.log("[Collector] Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("[Collector] MongoDB Connected.");

  const User = require("../models/User");
  const Exam = require("../models/Exam");
  const VerificationResult = require("../models/VerificationResult");
  const ResumeAnalysis = require("../models/ResumeAnalysis");

  // 1. Register Candidate
  console.log("[Collector] 1. Registering Candidate...");
  const t0 = Date.now();
  const regRes = await axios.post(`${API_BASE}/users`, {
    name: "Evidence Candidate",
    email: `evidence_${Date.now()}@veriproof.io`,
    password: "Password123!",
    role: "student",
    origin: "self_registered",
  });
  const t1 = Date.now();
  recordHttp("POST", "/api/users", regRes.status, t1 - t0, regRes.data);

  const token = regRes.data.token;
  const userId = regRes.data._id || regRes.data.id || (regRes.data.user && regRes.data.user._id);
  const headers = { Authorization: `Bearer ${token}` };

  // 2. Set GitHub Username
  const t2 = Date.now();
  const profileRes = await axios.put(`${API_BASE}/users/profile`, { githubUsername: "mizudotdev" }, { headers });
  const t3 = Date.now();
  recordHttp("PUT", "/api/users/profile", profileRes.status, t3 - t2, profileRes.data);

  // 3. Upload Resume
  console.log("[Collector] 2. Uploading Resume PDF...");
  const form = new FormData();
  const dummyPath = path.join(__dirname, "dummy_resume.txt");
  if (!fs.existsSync(dummyPath)) {
    fs.writeFileSync(dummyPath, "Experienced Full Stack Engineer proficient in React, Node.js, Express, MongoDB, and Python.");
  }
  form.append("resume", fs.createReadStream(dummyPath), { filename: "dummy_resume.txt", contentType: "text/plain" });

  const t4 = Date.now();
  const uploadRes = await axios.post(`${API_BASE}/users/profile/resume-file`, form, {
    headers: { ...headers, ...form.getHeaders() },
  });
  const t5 = Date.now();
  recordHttp("POST", "/api/users/profile/resume-file", uploadRes.status, t5 - t4, uploadRes.data);

  // 4. Poll for Analysis & GitHub completion
  console.log("[Collector] 3. Polling for Analysis completion...");
  while (true) {
    const tPoll0 = Date.now();
    const resAnalysis = await axios.get(`${API_BASE}/users/profile/resume-analysis`, { headers }).catch(() => ({ status: 200, data: { status: "Parsing" } }));
    const tPoll1 = Date.now();
    recordHttp("GET", "/api/users/profile/resume-analysis", resAnalysis.status, tPoll1 - tPoll0, resAnalysis.data);

    if (resAnalysis.data.status === "Analysis Complete") {
      const ghRes = await axios.get(`${API_BASE}/github/status`, { headers });
      recordHttp("GET", "/api/github/status", ghRes.status, 0, ghRes.data);
      if (ghRes.data.status === "complete") break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 5. Start Exam
  console.log("[Collector] 4. Starting Exam...");
  const tStart0 = Date.now();
  const examStartRes = await axios.get(`${API_BASE}/exams/start`, { headers });
  const tStart1 = Date.now();
  recordHttp("GET", "/api/exams/start", examStartRes.status, tStart1 - tStart0, { questionCount: examStartRes.data.length });

  // --- MONGO SNAPSHOT: BEFORE EXAM SUBMISSION ---
  console.log("[Collector] 5. Capturing MongoDB Snapshot BEFORE Exam Submission...");
  const userBefore = await User.findById(userId).lean();
  const vResultBefore = await VerificationResult.findOne({ candidateId: userId }).lean();
  const examBefore = await Exam.findOne({ "questions._id": { $in: examStartRes.data.map((q) => q._id) } }).lean();
  const resumeAnalysisBefore = await ResumeAnalysis.findOne({ candidateId: userId, active: true }).lean();

  evidenceLog.mongoSnapshots.beforeExam = {
    pipelineStage: userBefore.pipelineStage,
    certificatesCount: userBefore.certificates?.length || 0,
    skillProgress: userBefore.skillProgress,
    vResultExists: Boolean(vResultBefore),
    vResult: vResultBefore,
    examStatus: examBefore?.status || "None",
    resumeClaimsCount: resumeAnalysisBefore?.claims?.skills?.length || 0,
  };

  // 6. Submit Exam Answers
  console.log("[Collector] 6. Submitting Exam...");
  const answers = examStartRes.data.map((q) => ({
    questionId: q._id,
    answerIndex: 0,
  }));

  const tSub0 = Date.now();
  const submitRes = await axios.post(`${API_BASE}/exams/submit`, { answers }, { headers });
  const tSub1 = Date.now();
  recordHttp("POST", "/api/exams/submit", submitRes.status, tSub1 - tSub0, submitRes.data);

  // --- MONGO SNAPSHOT: AFTER EXAM SUBMISSION ---
  console.log("[Collector] 7. Capturing MongoDB Snapshot AFTER Exam Submission...");
  const userAfter = await User.findById(userId).lean();
  const vResultAfter = await VerificationResult.findOne({ candidateId: userId }).lean();
  const examAfter = await Exam.findOne({ "questions._id": { $in: examStartRes.data.map((q) => q._id) } }).lean();

  evidenceLog.mongoSnapshots.afterExam = {
    pipelineStage: userAfter.pipelineStage,
    certificatesCount: userAfter.certificates?.length || 0,
    skillProgress: userAfter.skillProgress,
    vResultExists: Boolean(vResultAfter),
    vResult: vResultAfter,
    examStatus: examAfter?.status || "Completed",
  };

  // Compute Diffs
  evidenceLog.mongoSnapshots.diffs = {
    pipelineStageChanged: `${userBefore.pipelineStage} ──► ${userAfter.pipelineStage}`,
    certificatesAdded: userAfter.certificates.length - (userBefore.certificates?.length || 0),
    vResultCreated: !vResultBefore && Boolean(vResultAfter),
    vResultStatus: vResultAfter?.status,
    verifiedSkillsCount: userAfter.skillProgress?.verifiedCount || 0,
    trustScore: userAfter.skillProgress?.trustScore || 0,
  };

  // 7. Verify Dashboard Profile Refetch (Zero-F5 Simulation)
  console.log("[Collector] 8. Verifying Dashboard Profile Refetch (Zero-F5 Sync)...");
  const tSync0 = Date.now();
  const finalProfileRes = await axios.get(`${API_BASE}/users/profile`, { headers });
  const tSync1 = Date.now();
  recordHttp("GET", "/api/users/profile", finalProfileRes.status, tSync1 - tSync0, {
    pipelineStage: finalProfileRes.data.pipelineStage,
    workflowState: finalProfileRes.data.workflowState,
  });

  const treeRes = await axios.get(`${API_BASE}/skill-tree`, { headers });
  recordHttp("GET", "/api/skill-tree", treeRes.status, 0, {
    verifiedCount: treeRes.data.progress?.verifiedCount,
    trustScore: treeRes.data.progress?.trustScore,
  });

  evidenceLog.dashboardSyncState = {
    pipelineStage: finalProfileRes.data.pipelineStage,
    hasExamPassed: finalProfileRes.data.workflowState?.hasExamPassed,
    verifiedCount: treeRes.data.progress?.verifiedCount,
    trustScore: treeRes.data.progress?.trustScore,
    synchronizationSuccess: finalProfileRes.data.pipelineStage === "verification_complete" && finalProfileRes.data.workflowState?.hasExamPassed === true,
  };

  // Write snapshot log
  const outputPath = "C:\\Users\\shrid\\.gemini\\antigravity-ide\\brain\\84aec0c4-2037-4804-8630-af6f07072e89\\scratch\\evidence_snapshot.json";
  fs.writeFileSync(outputPath, JSON.stringify(evidenceLog, null, 2));
  console.log(`[Collector] ✅ Evidence Snapshot Saved to: ${outputPath}`);

  await mongoose.disconnect();
}

runEvidenceCollection().catch((err) => {
  console.error("[Collector] ❌ FAILED:", err.response ? err.response.data : err.message);
  mongoose.disconnect();
});
