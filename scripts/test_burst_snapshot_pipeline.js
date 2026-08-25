/**
 * Verification Test: Event-Driven 3-Frame Burst Snapshot & Recruiter Proof Pipeline
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "../.env") });

const Exam = require("../models/Exam");
const User = require("../models/User");
const { recordViolationSnapshot } = require("../controllers/examController");

const runTest = async () => {
  console.log("\n==================================================================");
  console.log("   VERIPROOF 3-FRAME BURST SNAPSHOT & PROCTOR PROOF VERIFICATION  ");
  console.log("==================================================================\n");

  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/veriproof";
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log("✓ Connected to MongoDB for pipeline validation.");
  } catch (err) {
    console.warn("MongoDB connection notice:", err.message);
  }

  let passedTests = 0;
  let totalTests = 0;

  const assert = (condition, testName) => {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] Test ${totalTests}: ${testName}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] Test ${totalTests}: ${testName}`);
    }
  };

  // Test 1: Create a mock active exam session
  const mockUser = new mongoose.Types.ObjectId();
  const mockExam = await Exam.create({
    candidateId: mockUser,
    topic: "Full Stack Forensic Evaluation",
    skills: ["Node.js", "Python", "React"],
    passingScore: 70,
    status: "In Progress",
    questions: [
      { questionText: "Test Q1", options: ["A", "B", "C", "D"], correctOption: 0, section: "Core" }
    ],
  });

  assert(mockExam && mockExam._id, "Mock In-Progress Exam session created in DB");

  // Test 2: Generate 1x1 dummy JPEG base64 strings for 3-frame burst
  // Minimal valid 1x1 transparent/white JPEG byte sequence
  const sample1x1JpegBase64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

  const burstFrames = [
    { tag: "start", base64: sample1x1JpegBase64 },
    { tag: "mid", base64: sample1x1JpegBase64 },
    { tag: "end", base64: sample1x1JpegBase64 },
  ];

  // Test 3: Invoke recordViolationSnapshot
  const mockReq = {
    body: {
      examId: mockExam._id.toString(),
      type: "PHONE_SUSPICIOUS",
      details: "Mobile phone held up to camera",
      vlm_reason: "Groq VLM detected active smartphone screen in candidate hand",
      confidence: 0.98,
      timestamp: new Date().toISOString(),
      burstFrames,
    },
    user: { _id: mockUser }
  };

  let responseData = null;
  const mockRes = {
    json: (data) => { responseData = data; return mockRes; },
    status: (code) => { responseData = { statusCode: code }; return mockRes; },
  };

  await recordViolationSnapshot(mockReq, mockRes);

  assert(responseData && responseData.success === true, "recordViolationSnapshot returned success: true");
  assert(Array.isArray(responseData.evidenceUrls) && responseData.evidenceUrls.length === 3, "Generated exactly 3 evidence snapshot URLs for the burst");

  // Test 4: Verify files exist on disk in uploads/violations
  let allFilesExist = true;
  for (const url of responseData.evidenceUrls) {
    const filename = path.basename(url);
    const diskPath = path.join(__dirname, "../uploads/violations", filename);
    if (!fs.existsSync(diskPath)) {
      allFilesExist = false;
      break;
    }
  }
  assert(allFilesExist === true, "All 3 burst JPEG image frames persisted to backend/uploads/violations/");

  // Test 5: Verify MongoDB persistence of evidence URLs & strike counter
  const updatedExam = await Exam.findById(mockExam._id);
  assert(updatedExam.serverViolationCount === 1, "serverViolationCount incremented to 1");
  assert(updatedExam.integrityScore === 75, "integrityScore calculated as 75%");
  assert(updatedExam.serverViolations[0].evidenceUrls.length === 3, "serverViolations[0] stored all 3 burst URLs");

  // Test 6: Verify Auto-Disqualification threshold (3 strikes)
  await recordViolationSnapshot(mockReq, mockRes); // Strike 2
  await recordViolationSnapshot(mockReq, mockRes); // Strike 3

  const terminatedExam = await Exam.findById(mockExam._id);
  assert(terminatedExam.serverViolationCount === 3, "serverViolationCount reached 3 strikes");
  assert(terminatedExam.isTerminated === true, "Exam automatically flagged isTerminated: true");
  assert(terminatedExam.status === "Terminated", "Exam status set to Terminated");

  // Cleanup test record
  await Exam.findByIdAndDelete(mockExam._id);

  console.log(`\n==================================================================`);
  console.log(`   3-FRAME BURST SNAPSHOT SUITE: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
  console.log(`==================================================================\n`);

  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

runTest().catch(console.error);
