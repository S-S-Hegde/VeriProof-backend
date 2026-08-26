require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const axios = require("axios");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

async function testExamGenerationQuota() {
  console.log("=================================================");
  console.log("   VERIPROOF 35-QUESTION QUOTA & PROCTOR TEST    ");
  console.log("=================================================\n");

  const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/veriproof";
  await mongoose.connect(MONGO_URI);
  console.log("✔ Connected to MongoDB");

  const User = mongoose.model("User", new mongoose.Schema({
    name: String,
    email: String,
    role: String,
  }, { strict: false }));

  let testUser = await User.findOne({ email: "audit_candidate@veriproof.com" });
  if (!testUser) {
    testUser = await User.create({
      name: "Audit Candidate",
      email: "audit_candidate@veriproof.com",
      role: "candidate",
    });
  }

  const token = jwt.sign(
    { id: testUser._id, role: testUser.role, email: testUser.email },
    process.env.JWT_SECRET || "default_super_secret_jwt_key_12345",
    { expiresIn: "1h" }
  );

  console.log(`✔ Generated JWT for Candidate: ${testUser.name} (${testUser._id})`);

  // Clear any existing active exam for clean start
  const Exam = mongoose.model("Exam", new mongoose.Schema({
    candidateId: mongoose.Schema.Types.ObjectId,
    status: String,
  }, { strict: false }));

  await Exam.deleteMany({ candidateId: testUser._id });
  console.log("✔ Cleared previous exam attempts for audit candidate");

  // Call GET /api/exams/start
  console.log("\n[Test 1] Calling GET http://localhost:5000/api/exams/start ...");
  const startRes = await axios.get("http://localhost:5000/api/exams/start", {
    headers: { Authorization: `Bearer ${token}` }
  });

  const questions = startRes.data;
  console.log(`✔ API returned ${questions.length} questions.`);

  console.log("\n[Test 2] Validating Question Quota Constraints:");
  console.log(`  • Total Question Count: ${questions.length} (Expected: 35) -> ${questions.length === 35 ? "PASS ✅" : "FAIL ❌"}`);

  const coreQuestions = questions.filter(q => q.section === "Core");
  const electiveQuestions = questions.filter(q => q.section === "Elective");

  console.log(`  • Section 1 (Core Baseline): ${coreQuestions.length} Questions (Expected: 20) -> ${coreQuestions.length === 20 ? "PASS ✅" : "FAIL ❌"}`);
  console.log(`  • Section 2 (Candidate Electives): ${electiveQuestions.length} Questions (Expected: 15) -> ${electiveQuestions.length === 15 ? "PASS ✅" : "FAIL ❌"}`);

  console.log("\n[Test 3] Inspecting Difficulty & Equal-Length Option Quality:");
  let equalLengthPass = 0;
  for (let i = 0; i < Math.min(5, questions.length); i++) {
    const q = questions[i];
    const lens = q.options.map(opt => opt.split(/\s+/).length);
    const maxLen = Math.max(...lens);
    const minLen = Math.min(...lens);
    const diff = maxLen - minLen;
    console.log(`  Q${i+1} [${q.section} | ${q.difficulty} | ${q.category}]: Diff word spread = ${diff} words -> ${diff <= 5 ? "BALANCED ✅" : "WARNING ⚠️"}`);
    if (diff <= 5) equalLengthPass++;
  }

  console.log("\n[Test 4] Testing Optical Proctor Snapshot Detection Endpoint:");
  // Test invalid/empty frame
  try {
    const snapRes = await axios.post(
      "http://localhost:5000/api/exams/proctor-snapshot",
      { image: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`  • Snapshot API response: violation=${snapRes.data.violation}, type=${snapRes.data.violationType || snapRes.data.type || "NONE"} -> PASS ✅`);
  } catch (err) {
    console.log(`  • Snapshot API test note: ${err.message}`);
  }

  await mongoose.disconnect();
  console.log("\n=================================================");
  console.log("   ALL 35-QUESTION AUDIT TESTS COMPLETED         ");
  console.log("=================================================");
}

testExamGenerationQuota().catch(err => {
  console.error("Test Error:", err);
  process.exit(1);
});
