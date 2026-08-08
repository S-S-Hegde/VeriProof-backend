const axios = require("axios");
const FormData = require("form-data");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const NODE_API = "http://localhost:5000/api";

const TEST_RESUME = `Alex Rivera
Email: alex.rivera.test@example.com | GitHub: alexrivera-dev | Phone: +1 555-9876

PROFESSIONAL SUMMARY
Senior Full Stack Engineer with 5+ years of experience in React, Node.js, Express, MongoDB, and Python.

TECHNICAL SKILLS
- Languages: JavaScript, TypeScript, Python, SQL
- Frontend: React, Redux, TailwindCSS
- Backend: Node.js, Express, REST APIs, GraphQL, MongoDB, PostgreSQL`;

async function runNewWorkflowTest() {
  console.log("=========================================================================");
  console.log("   VERIPROOF END-TO-END WORKFLOW INTEGRATION TEST                        ");
  console.log("=========================================================================\n");

  const rand = Math.floor(Math.random() * 100000);
  const recruiterEmail = `recruiter_test_${rand}@veriproof.com`;
  const recruiterPassword = "Password123!";
  const candidateEmail = `alex.rivera.test_${rand}@example.com`;

  // 1. Recruiter Registers
  console.log("[1/6] Registering Recruiter...");
  const recAuth = await axios.post(`${NODE_API}/users`, {
    name: "Lead Tech Recruiter",
    email: recruiterEmail,
    password: recruiterPassword,
    role: "recruiter"
  });
  const rHeaders = { headers: { Authorization: `Bearer ${recAuth.data.token}` } };
  console.log(`✓ Recruiter Registered: ${recruiterEmail}`);

  // 2. Recruiter Creates Job Role
  console.log("\n[2/6] Creating Job Role...");
  const jobRes = await axios.post(`${NODE_API}/verify/job`, {
    title: "Senior Full Stack Engineer",
    description: "Seeking experienced React and Node.js developer.",
    targetSkills: ["React", "Node.js", "MongoDB", "JavaScript"],
    experienceRequired: "3+ years"
  }, rHeaders);
  const jobId = jobRes.data._id;
  console.log(`✓ Job Created: ID=${jobId}`);

  // 3. Recruiter Bulk Uploads Resume -> Triggers Pre-Create Account
  console.log("\n[3/6] Recruiter Uploads Candidate Resume...");
  const form = new FormData();
  form.append("jobId", jobId);
  form.append("resumes", Buffer.from(TEST_RESUME.replace("alex.rivera.test@example.com", candidateEmail)), {
    filename: "alex_rivera_resume.txt",
    contentType: "text/plain"
  });

  const uploadRes = await axios.post(`${NODE_API}/verify/applicants/upload`, form, {
    headers: { ...rHeaders.headers, ...form.getHeaders() }
  });
  console.log(`✓ Resume Uploaded & Parsed. Total Applicants Processed: ${uploadRes.data.length}`);
  const applicantRecord = uploadRes.data[0];
  console.log(`  Extracted Name: "${applicantRecord.extractedName}" | Alignment Score: ${applicantRecord.alignmentScore}%`);

  // 4. Candidate Account Pre-Creation & OTP Sign-in Check
  console.log("\n[4/6] Candidate Sign-In & OTP 2FA Verification...");
  
  const User = require("../models/User");
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/veriproof");
  const preCreatedUser = await User.findOne({ email: candidateEmail.toLowerCase() });
  
  if (!preCreatedUser) {
    throw new Error(`FAIL: Pre-created candidate user for ${candidateEmail} was not found in DB!`);
  }
  console.log(`✓ Candidate User Pre-Created in DB! ID=${preCreatedUser._id}, origin="${preCreatedUser.origin}"`);

  preCreatedUser.password = "CandidatePass123!";
  await preCreatedUser.save();

  const loginRes = await axios.post(`${NODE_API}/users/login`, {
    email: candidateEmail,
    password: "CandidatePass123!",
    role: "student"
  });

  console.log(`✓ Candidate Login Response: requiresOTP=${loginRes.data.requiresOTP}`);
  if (!loginRes.data.requiresOTP) {
    throw new Error("FAIL: Invited candidate first login did not trigger requiresOTP!");
  }

  const candidateWithOtp = await User.findById(preCreatedUser._id);
  const testOtp = candidateWithOtp.getOtpToken();
  await candidateWithOtp.save();

  const otpRes = await axios.post(`${NODE_API}/users/verify-otp`, {
    email: candidateEmail,
    otp: testOtp
  });
  console.log(`✓ Candidate OTP Verified Successfully! JWT Token Issued.`);
  const candidateToken = otpRes.data.token;
  const cHeaders = { headers: { Authorization: `Bearer ${candidateToken}` } };

  // 5. Candidate Start & Submit Exam
  console.log("\n[5/6] Candidate Taking Technical Assessment...");
  const examStart = await axios.get(`${NODE_API}/exams/start`, cHeaders);
  console.log(`✓ Exam Generated: ${examStart.data.length} questions`);

  const examSubmit = await axios.post(`${NODE_API}/exams/submit`, {
    answers: examStart.data.map((q, idx) => ({ questionId: q._id, answerIndex: idx % 4 }))
  }, cHeaders);
  console.log(`✓ Exam Submitted Successfully! Score: ${examSubmit.data.score}% | Status: ${examSubmit.data.status}`);

  // 6. Recruiter Daily Digest & Shortlist Rank Persistence
  console.log("\n[6/6] Recruiter Daily Digest & Shortlist Management...");
  
  const shortlistRes = await axios.put(`${NODE_API}/verify/applicants/shortlist`, {
    rankings: [
      { id: applicantRecord._id, shortlistRank: 1, shortlisted: true }
    ]
  }, rHeaders);
  console.log(`✓ Shortlist Rankings Saved: count=${shortlistRes.data.count}`);

  const digestRes = await axios.post(`${NODE_API}/verify/daily-digest`, {}, rHeaders);
  console.log(`✓ Daily Digest Triggered: message="${digestRes.data.message}", sent=${digestRes.data.sent}`);

  await mongoose.disconnect();

  console.log("\n=========================================================================");
  console.log("   ✅ ALL NEW WORKFLOW FEATURES PASSED FULL INTEGRATION VERIFICATION!   ");
  console.log("=========================================================================");
}

runNewWorkflowTest().catch(err => {
  console.error("❌ INTEGRATION TEST FAILED:", err.response ? err.response.data : err.message);
  mongoose.disconnect();
  process.exit(1);
});
