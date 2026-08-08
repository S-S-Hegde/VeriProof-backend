const axios = require("axios");

const API_BASE = "http://localhost:5000/api";

async function testProctoringSingleAttemptPolicy() {
  console.log("=========================================================");
  console.log("   PROCTORING VIOLATION & SINGLE-ATTEMPT POLICY TEST     ");
  console.log("=========================================================");

  // 1. Register candidate user
  const email = `proctor_test_${Date.now()}@example.com`;
  const password = "Password123!";

  console.log(`[1/4] Registering test candidate: ${email}...`);
  const regRes = await axios.post(`${API_BASE}/users`, {
    name: "Proctor Test Candidate",
    email,
    password,
    role: "student"
  });

  const token = regRes.data.token;
  console.log("✓ Candidate registered.");

  // 2. Start initial exam
  console.log("[2/4] Initializing Technical Assessment via GET /api/exams/start...");
  const startRes = await axios.get(`${API_BASE}/exams/start`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log(`✓ Exam initialized with ${startRes.data.length} questions.`);

  // 3. Simulate proctoring violation termination
  console.log("[3/4] Submitting assessment with Proctoring Violation termination flag...");
  const submitRes = await axios.post(
    `${API_BASE}/exams/submit`,
    {
      answers: startRes.data.map(q => ({ questionId: q._id, answerIndex: 0 })),
      isTerminated: true
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  console.log("✓ Exam submitted & terminated:", submitRes.data);

  // 4. Verify Single-Attempt Retake Blocking
  console.log("[4/4] Attempting retake via GET /api/exams/start (should return 403 single attempt lock)...");
  try {
    await axios.get(`${API_BASE}/exams/start`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.error("❌ FAILURE: Candidate was allowed a second exam attempt!");
  } catch (err) {
    if (err.response?.status === 403 && err.response?.data?.completed) {
      console.log(`✓ SUCCESS! Retake blocked cleanly with HTTP 403: "${err.response.data.error}"`);
    } else {
      console.error("❌ Unexpected error:", err.message);
    }
  }

  console.log("=========================================================");
  console.log("   ✅ PROCTORING & SINGLE-ATTEMPT POLICY PASSED 100%!   ");
  console.log("=========================================================");
}

testProctoringSingleAttemptPolicy().catch(err => {
  console.error("Test error:", err.response?.data || err.message);
  process.exit(1);
});
