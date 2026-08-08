const axios = require("axios");
const FormData = require("form-data");

const NODE_API = "http://localhost:5000/api";

const TEST_RESUME = `Marcus Brody
Email: marcus.brody@example.com | GitHub: marcusbrody | Phone: +1 555-0177

PROFESSIONAL SUMMARY
Senior Full Stack Engineer with 7+ years building enterprise React, Node.js, Express, MongoDB, and Python microservices.

TECHNICAL SKILLS
- Frontend: React.js, TypeScript, Next.js, HTML/CSS, Redux
- Backend & DB: Node.js, Express, Python, MongoDB, PostgreSQL, Redis
- Tools: Docker, Git, CI/CD, Jest`;

async function runPhase40BrowserScenariosAudit() {
  console.log("=========================================================================");
  console.log("   PHASE 40 — CANONICAL PIPELINE STABILIZATION & SCENARIO AUDIT          ");
  console.log("=========================================================================\n");

  const rand = Math.floor(Math.random() * 10000);
  const password = "Password123!";

  // -------------------------------------------------------------------------
  // SCENARIO A: Self-Registered Candidate Workflow
  // -------------------------------------------------------------------------
  console.log("--- SCENARIO A: SELF-REGISTERED CANDIDATE WORKFLOW ---");
  const selfEmail = `self_candidate_${rand}@test.com`;

  const selfAuth = await axios.post(`${NODE_API}/users`, {
    name: "Self Candidate A",
    email: selfEmail,
    password,
    role: "student"
  });
  const selfHeaders = { headers: { Authorization: `Bearer ${selfAuth.data.token}` } };

  const selfProfile = await axios.get(`${NODE_API}/users/profile`, selfHeaders);
  console.log(`✓ Scenario A Registered: Email="${selfEmail}"`);
  console.log(`  Origin: "${selfProfile.data.origin}" | Stage: "${selfProfile.data.pipelineStage}"`);

  if (selfProfile.data.origin !== "self_registered" || selfProfile.data.pipelineStage !== "resume_upload") {
    throw new Error("FAIL: Self candidate origin/stage incorrect!");
  }

  // Upload Resume
  const selfForm = new FormData();
  selfForm.append("resume", Buffer.from(TEST_RESUME), { filename: "marcus_resume.txt", contentType: "text/plain" });

  const uploadRes = await axios.post(`${NODE_API}/users/profile/resume-file`, selfForm, {
    headers: { ...selfHeaders.headers, ...selfForm.getHeaders() }
  });
  console.log(`✓ Scenario A Resume Uploaded: Status="${uploadRes.data.resumeStatus}"`);

  // Start Assessment
  const selfExamStart = await axios.get(`${NODE_API}/exams/start`, selfHeaders);
  console.log(`✓ Scenario A Assessment Started: ${selfExamStart.data.length} questions`);

  const selfExamSubmit = await axios.post(`${NODE_API}/exams/submit`, {
    answers: selfExamStart.data.map(q => ({ questionId: q._id, answerIndex: 0 }))
  }, selfHeaders);
  console.log(`✓ Scenario A Assessment Submitted! Score: ${selfExamSubmit.data.score}%`);
  console.log("  SCENARIO A VERDICT: PASS ✅");

  // -------------------------------------------------------------------------
  // SCENARIO B & C: Recruiter Invited Candidate & Workspace Synchronization
  // -------------------------------------------------------------------------
  console.log("\n--- SCENARIO B & C: RECRUITER INVITED CANDIDATE & DASHBOARD SYNC ---");
  const recruiterEmail = `phase40_recruiter_${rand}@test.com`;
  const invitedEmail = `invited_candidate_${rand}@test.com`;

  const recAuth = await axios.post(`${NODE_API}/users`, {
    name: "Phase 40 Lead Recruiter",
    email: recruiterEmail,
    password,
    role: "recruiter"
  });
  const rHeaders = { headers: { Authorization: `Bearer ${recAuth.data.token}` } };

  const jobRes = await axios.post(`${NODE_API}/verify/job`, {
    title: "Senior Full Stack Engineer",
    description: "React, Node.js, Express, MongoDB, Python required",
    targetSkills: ["React", "Node.js", "Express", "MongoDB", "Python"],
    experienceRequired: "5+ years"
  }, rHeaders);
  const jobId = jobRes.data._id;

  // Recruiter Upload Intake
  const recForm = new FormData();
  recForm.append("jobId", jobId);
  recForm.append("resumes", Buffer.from(TEST_RESUME.replace("marcus.brody@example.com", invitedEmail)), {
    filename: "marcus_resume.txt",
    contentType: "text/plain"
  });

  await axios.post(`${NODE_API}/verify/applicants/upload`, recForm, {
    headers: { ...rHeaders.headers, ...recForm.getHeaders() }
  });
  console.log(`✓ Recruiter Uploaded Intake Resume for "${invitedEmail}"`);

  // Candidate Registers
  const invAuth = await axios.post(`${NODE_API}/users`, {
    name: "Marcus Brody",
    email: invitedEmail,
    password,
    role: "student"
  });
  const invHeaders = { headers: { Authorization: `Bearer ${invAuth.data.token}` } };

  const invProfile = await axios.get(`${NODE_API}/users/profile`, invHeaders);
  console.log(`✓ Scenario B Candidate Registered: Email="${invitedEmail}"`);
  console.log(`  Origin: "${invProfile.data.origin}" | Stage: "${invProfile.data.pipelineStage}" | ResumeUrl: "${invProfile.data.resumeUrl ? 'PRESENT' : 'MISSING'}"`);

  if (invProfile.data.origin !== "recruiter_invited" || !invProfile.data.resumeUrl) {
    throw new Error("FAIL: Invited candidate evidence hydration failed!");
  }
  console.log("  SCENARIO B VERDICT: PASS ✅ (No Resume Upload Required, Read-Only Evidence Lock)");

  // Assessment & Recruiter Workspace Sync
  const invExamStart = await axios.get(`${NODE_API}/exams/start`, invHeaders);
  const invExamSubmit = await axios.post(`${NODE_API}/exams/submit`, {
    answers: invExamStart.data.map(q => ({ questionId: q._id, answerIndex: 0 }))
  }, invHeaders);
  console.log(`✓ Invited Candidate Submitted Assessment: Score=${invExamSubmit.data.score}%`);

  const applicantsList = await axios.get(`${NODE_API}/verify/applicants?jobId=${jobId}`, rHeaders);
  const matched = applicantsList.data.find(a => a.extractedEmail === invitedEmail.toLowerCase());

  console.log(`✓ Recruiter Workspace Synchronized:`, {
    email: matched?.extractedEmail,
    status: matched?.status,
    alignmentScore: matched?.alignmentScore,
    examScore: matched?.examScore
  });

  if (matched?.status !== "Completed") {
    throw new Error("FAIL: Recruiter applicant status was not updated to Completed!");
  }
  console.log("  SCENARIO C VERDICT: PASS ✅");

  // -------------------------------------------------------------------------
  // SCENARIO D: Account Deletion End-to-End
  // -------------------------------------------------------------------------
  console.log("\n--- SCENARIO D: ACCOUNT DELETION END-TO-END ---");
  const delEmail = `del_candidate_${rand}@test.com`;

  const delAuth = await axios.post(`${NODE_API}/users`, {
    name: "To Be Deleted",
    email: delEmail,
    password,
    role: "student"
  });
  const delHeaders = { headers: { Authorization: `Bearer ${delAuth.data.token}` } };

  const delRes = await axios.delete(`${NODE_API}/users/profile`, {
    ...delHeaders,
    data: { password }
  });
  console.log(`✓ Account Delete Request Returned HTTP ${delRes.status}: "${delRes.data.message}"`);

  // Verify candidate can no longer log in
  try {
    await axios.post(`${NODE_API}/users/login`, { email: delEmail, password });
    throw new Error("FAIL: Deleted candidate was still able to log in!");
  } catch (err) {
    if (err.response && (err.response.status === 401 || err.response.status === 404)) {
      console.log(`✓ Login Attempt Post-Deletion Rejected cleanly with HTTP ${err.response.status}: "${err.response.data.message}"`);
    } else {
      throw err;
    }
  }
  console.log("  SCENARIO D VERDICT: PASS ✅");

  console.log("\n=========================================================================");
  console.log("   ✅ PHASE 40 CANONICAL PIPELINE STABILIZATION PASSED 100%!            ");
  console.log("=========================================================================");
}

runPhase40BrowserScenariosAudit().catch(err => {
  console.error("❌ FATAL AUDIT ERROR:", err.response ? err.response.data : err.message);
  process.exit(1);
});
