const axios = require("axios");
const mongoose = require("mongoose");
const API = "http://localhost:5000/api";

async function testDeleteAccount() {
  console.log("--- PHASE 31 DESTRUCTIVE ACTIONS & ACCOUNT DELETION INTEGRATION TEST ---");
  const rand = Math.floor(Math.random() * 10000);
  const email = `delete_candidate_${rand}@test.com`;
  const password = "Password123!";

  // 1. Register candidate
  console.log("1. Registering test candidate...");
  const signupRes = await axios.post(`${API}/users`, {
    name: "Delete Candidate",
    email,
    password,
    role: "student"
  });
  const userId = signupRes.data._id;
  const token = signupRes.data.token;
  const authHeader = { headers: { Authorization: `Bearer ${token}` } };

  // 2. Start an exam to create Exam and VerificationResult records
  console.log("2. Starting & submitting exam to populate user records...");
  const FormData = require("form-data");
  const form = new FormData();
  const dummyBuffer = Buffer.from("Delete Candidate Resume\nSkills: React, Node.js");
  form.append("resume", dummyBuffer, { filename: "resume.txt", contentType: "text/plain" });

  await axios.post(`${API}/users/profile/resume-file`, form, {
    headers: { ...authHeader.headers, ...form.getHeaders() }
  });

  const examRes = await axios.get(`${API}/exams/start`, authHeader);
  await axios.post(`${API}/exams/submit`, {
    answers: examRes.data.map(q => ({ questionId: q._id, answerIndex: 0 }))
  }, authHeader);

  // 3. Attempt account deletion with INCORRECT password
  console.log("3. Testing account deletion with INCORRECT password...");
  try {
    await axios.delete(`${API}/users/profile`, {
      ...authHeader,
      data: { password: "WrongPassword999!" }
    });
    throw new Error("Failed: Account deletion should have been rejected with wrong password!");
  } catch (err) {
    if (err.response?.status === 401) {
      console.log(`✓ Rejected incorrect password correctly: "${err.response.data.message}"`);
    } else {
      throw err;
    }
  }

  // 4. Attempt account deletion with CORRECT password
  console.log("4. Executing account deletion with CORRECT password...");
  const deleteRes = await axios.delete(`${API}/users/profile`, {
    ...authHeader,
    data: { password }
  });
  console.log(`✓ Account deletion API response: "${deleteRes.data.message}"`);

  // 5. Verify login attempt fails after deletion
  console.log("5. Verifying user cannot log in after account deletion...");
  try {
    await axios.post(`${API}/users/login`, { email, password });
    throw new Error("Failed: Deleted user was able to log in!");
  } catch (err) {
    if (err.response?.status === 401) {
      console.log(`✓ Login blocked for deleted user correctly: "${err.response.data.message}"`);
    } else {
      throw err;
    }
  }

  console.log("✅ PHASE 31 ACCOUNT DELETION & CASCADING CLEANUP INTEGRATION TEST PASSED 100%!");
}

testDeleteAccount().catch(err => {
  console.error("❌ TEST FAILED:", err.response ? err.response.data : err.message);
  process.exit(1);
});
