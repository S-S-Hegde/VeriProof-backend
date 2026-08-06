const axios = require("axios");
const API = "http://localhost:5000/api";

async function testExamHistory() {
  console.log("--- PHASE 30 EXAMINATION HISTORY & MULTI-ATTEMPT TEST ---");
  const rand = Math.floor(Math.random() * 10000);
  const email = `candidate_history_${rand}@test.com`;

  // 1. Register candidate
  console.log("1. Registering candidate...");
  const signupRes = await axios.post(`${API}/users`, {
    name: "Exam History Candidate",
    email,
    password: "Password123!",
    role: "student"
  });
  const token = signupRes.data.token;
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

  // 1b. Upload resume to reach repository_analysis stage
  console.log("1b. Uploading resume...");
  const FormData = require("form-data");
  const form = new FormData();
  const dummyBuffer = Buffer.from("Exam Candidate Resume\nSkills: Python, React, SQL");
  form.append("resume", dummyBuffer, { filename: "resume.txt", contentType: "text/plain" });

  await axios.post(`${API}/users/profile/resume-file`, form, {
    headers: { ...authHeader.headers, ...form.getHeaders() }
  });

  // 2. Start and Submit Attempt 1
  console.log("2. Starting and submitting Attempt 1...");
  const exam1 = await axios.get(`${API}/exams/start`, authHeader);
  const submit1 = await axios.post(`${API}/exams/submit`, {
    answers: exam1.data.map(q => ({ questionId: q._id, answerIndex: 0 }))
  }, authHeader);
  console.log(`Attempt 1 Score: ${submit1.data.score}% | Status: ${submit1.data.status}`);

  // 3. Start and Submit Attempt 2
  console.log("3. Starting and submitting Attempt 2...");
  const exam2 = await axios.get(`${API}/exams/start`, authHeader);
  const submit2 = await axios.post(`${API}/exams/submit`, {
    answers: exam2.data.map((q, idx) => ({ questionId: q._id, answerIndex: idx % 2 === 0 ? 0 : 1 }))
  }, authHeader);
  console.log(`Attempt 2 Score: ${submit2.data.score}% | Status: ${submit2.data.status}`);

  // 4. Fetch Exam History
  console.log("4. Fetching Exam History via GET /api/exams/history...");
  const historyRes = await axios.get(`${API}/exams/history`, authHeader);
  const { history, analytics } = historyRes.data;

  console.log(`Total Attempts Found: ${history.length}`);
  console.log(`Analytics: Best Score: ${analytics.bestScore}% | Avg Score: ${analytics.avgScore}% | Pass Rate: ${analytics.passRate}%`);

  if (history.length !== 2) throw new Error(`Expected 2 attempts in history, found ${history.length}`);
  if (history[0].attemptNumber !== 1 || history[1].attemptNumber !== 2) throw new Error("Attempt numbering sequence mismatch");

  console.log("✅ PHASE 30 EXAMINATION HISTORY & MULTI-ATTEMPT TEST PASSED 100%!");
}

testExamHistory().catch(err => {
  console.error("❌ TEST FAILED:", err.response ? err.response.data : err.message);
  process.exit(1);
});
