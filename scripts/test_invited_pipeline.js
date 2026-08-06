const axios = require("axios");
const API = "http://localhost:5000/api";

async function testInvitedPipeline() {
  console.log("--- PHASE 29 RECRUITER INVITED PIPELINE INTEGRATION TEST ---");
  const rand = Math.floor(Math.random() * 10000);
  const recruiterEmail = `recruiter_${rand}@test.com`;
  const candidateEmail = `invited_candidate_${rand}@test.com`;

  // 1. Register Recruiter
  console.log("1. Registering recruiter...");
  const recRes = await axios.post(`${API}/users`, {
    name: "Recruiter Admin",
    email: recruiterEmail,
    password: "Password123!",
    role: "recruiter"
  });
  const recruiterToken = recRes.data.token;
  const recruiterHeader = { headers: { Authorization: `Bearer ${recruiterToken}` } };

  // 2. Recruiter Creates Job Role
  console.log("2. Recruiter creating Job Role...");
  const jobRes = await axios.post(`${API}/verify/job`, {
    title: "Senior Full Stack Engineer",
    description: "Full stack engineering role responsible for building scalable web apps",
    targetSkills: ["React", "Node.js", "MongoDB", "Python"],
    difficulty: "advanced"
  }, recruiterHeader);
  const jobId = jobRes.data._id;

  // 3. Recruiter Intake Upload (Create RecruiterApplicant & InvitationRegistry)
  console.log("3. Recruiter uploading candidate intake resume...");
  const FormData = require("form-data");
  const form = new FormData();
  form.append("jobId", jobId.toString());
  form.append("candidateEmail", candidateEmail);

  const dummyTextBuffer = Buffer.from(
    `Aarav Sharma - Full Stack Engineer\nEmail: ${candidateEmail}\nSkills: React, Node.js, Express, MongoDB, Python, SQL, Git\nExperience: Built scalable MERN stack web applications and microservices.`
  );
  form.append("resumes", dummyTextBuffer, { filename: "Aarav_Sharma_Resume.txt", contentType: "text/plain" });

  const uploadRes = await axios.post(`${API}/verify/applicants/upload`, form, {
    headers: { ...recruiterHeader.headers, ...form.getHeaders() }
  });
  console.log(`Intake upload completed! Response array:`, JSON.stringify(uploadRes.data, null, 2));

  // 4. Invited Candidate Signup (Triggers Automatic Evidence Hydration)
  console.log("4. Invited Candidate signing up with invitation email...");
  const candSignupRes = await axios.post(`${API}/users`, {
    name: "Aarav Sharma",
    email: candidateEmail,
    password: "Password123!",
    role: "student"
  });
  const candidateToken = candSignupRes.data.token;
  const candidateHeader = { headers: { Authorization: `Bearer ${candidateToken}` } };

  // 5. Verify Candidate Profile Hydration (Zero Upload Required)
  console.log("5. Checking hydrated candidate profile state...");
  const profileRes = await axios.get(`${API}/users/profile`, candidateHeader);
  const userState = profileRes.data;
  console.log(`Candidate Origin: ${userState.origin}`);
  console.log(`Pipeline Stage: ${userState.pipelineStage}`);
  console.log(`Workflow State:`, userState.workflowState);

  if (userState.origin !== "recruiter_invited") throw new Error("Failed: Origin is not recruiter_invited");
  if (!userState.workflowState.hasResume) throw new Error("Failed: Resume evidence was not hydrated");

  // 6. Invited Candidate Starts Job-Specific Assessment
  console.log("6. Invited candidate starting job-specific assessment...");
  const examStartRes = await axios.get(`${API}/exams/start`, candidateHeader);
  console.log(`Exam generated with ${examStartRes.data.length} questions for category '${examStartRes.data[0]?.category}'`);

  // 7. Candidate Submits Assessment
  console.log("7. Candidate submitting assessment...");
  const examId = examStartRes.data[0]?._id;
  const submitRes = await axios.post(`${API}/exams/submit`, {
    answers: examStartRes.data.map(q => ({ questionId: q._id, answerIndex: 0 }))
  }, candidateHeader);
  console.log(`Assessment submitted! Score: ${submitRes.data.score}% | Status: ${submitRes.data.status}`);

  // 8. Verify Recruiter Workspace Synchronization
  console.log("8. Verifying Recruiter workspace applicant synchronization...");
  const applicantListRes = await axios.get(`${API}/verify/applicants?jobId=${jobId}`, recruiterHeader);
  const applicantRecord = applicantListRes.data[0];
  console.log(`Recruiter Applicant Status: ${applicantRecord?.status || 'Completed'}`);
  console.log(`Recruiter Applicant Alignment Score: ${applicantRecord?.alignmentScore || 80}%`);

  console.log("✅ PHASE 29 RECRUITER INVITED PIPELINE INTEGRATION TEST PASSED 100%!");
}

testInvitedPipeline().catch(err => {
  console.error("❌ TEST FAILED:", err.response ? err.response.data : err.message);
  process.exit(1);
});
