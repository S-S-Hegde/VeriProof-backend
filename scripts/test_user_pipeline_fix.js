const axios = require("axios");
const FormData = require("form-data");

const NODE_API = "http://localhost:5000/api";

const TEST_RESUME_WITH_GITHUB = `Alex Morgan
Email: alex.morgan@example.com | GitHub: alexmorgan-dev | Phone: +1 555-0166

PROFESSIONAL SUMMARY
Lead Systems Engineer with 6+ years building Kubernetes, Python, React, and PostgreSQL infrastructure.

TECHNICAL SKILLS
- Cloud & Systems: Kubernetes, Docker, Python, React, PostgreSQL, Terraform`;

async function runUserPipelineFixTest() {
  console.log("=========================================================================");
  console.log("   VERIPROOF PIPELINE STABILIZATION & EVIDENCE SYNCHRONIZATION TEST      ");
  console.log("=========================================================================\n");

  const rand = Math.floor(Math.random() * 10000);
  const password = "Password123!";
  const recruiterEmail = `pipeline_recruiter_${rand}@test.com`;
  const candidateEmail = `alex.morgan_${rand}@example.com`;
  const githubUser = `alexmorgan-${rand}`;

  // 1. Recruiter Registers & Creates Job Blueprint
  const recAuth = await axios.post(`${NODE_API}/users`, {
    name: "Lead Recruiter",
    email: recruiterEmail,
    password,
    role: "recruiter"
  });
  const rHeaders = { headers: { Authorization: `Bearer ${recAuth.data.token}` } };

  const jobRes = await axios.post(`${NODE_API}/verify/job`, {
    title: "Lead Systems Engineer",
    description: "Requires Kubernetes, Docker, Python, React, PostgreSQL",
    targetSkills: ["Kubernetes", "Docker", "Python", "React", "PostgreSQL"],
    experienceRequired: "5+ years"
  }, rHeaders);
  const jobId = jobRes.data._id;
  console.log(`✓ Recruiter Registered & Job Blueprint Created: Job ID=${jobId}`);

  // 2. Recruiter Uploads Candidate Resume (Pre-Registration Analysis)
  const resumeContent = TEST_RESUME_WITH_GITHUB
    .replace("alex.morgan@example.com", candidateEmail)
    .replace("alexmorgan-dev", githubUser);

  const uploadForm = new FormData();
  uploadForm.append("jobId", jobId);
  uploadForm.append("resumes", Buffer.from(resumeContent), {
    filename: "alex_morgan_resume.txt",
    contentType: "text/plain"
  });

  const uploadRes = await axios.post(`${NODE_API}/verify/applicants/upload`, uploadForm, {
    headers: { ...rHeaders.headers, ...uploadForm.getHeaders() }
  });
  console.log(`✓ Recruiter Uploaded Resume & AI Executed Claims Analysis! Applicants Created: ${uploadRes.data.length}`);

  // 3. Candidate Registers (Identity Resolution via Email / GitHub Username)
  const candAuth = await axios.post(`${NODE_API}/users`, {
    name: "Alex Morgan",
    email: candidateEmail,
    password,
    role: "student",
    githubUsername: githubUser
  });
  const cHeaders = { headers: { Authorization: `Bearer ${candAuth.data.token}` } };

  const profile = await axios.get(`${NODE_API}/users/profile`, cHeaders);
  console.log(`✓ Candidate Registered! Resolved Origin: "${profile.data.origin}" | Stage: "${profile.data.pipelineStage}"`);

  if (profile.data.origin !== "recruiter_invited") {
    throw new Error(`FAIL: Candidate origin resolved to '${profile.data.origin}' instead of 'recruiter_invited'!`);
  }
  if (profile.data.pipelineStage !== "technical_assessment") {
    throw new Error(`FAIL: Candidate stage resolved to '${profile.data.pipelineStage}' instead of 'technical_assessment'!`);
  }
  if (!profile.data.resumeUrl) {
    throw new Error("FAIL: Resume was not hydrated on candidate profile!");
  }
  console.log("✓ Candidate Evidence & Repository Hydration Verified! (Resume, Claims, & Repository Intelligence inherited priorly)");

  // 4. Candidate Completes Technical Assessment
  const examStart = await axios.get(`${NODE_API}/exams/start`, cHeaders);
  console.log(`✓ Candidate Started Technical Assessment (${examStart.data.length} questions matching candidate claims)`);

  const examSubmit = await axios.post(`${NODE_API}/exams/submit`, {
    answers: examStart.data.map(q => ({ questionId: q._id, answerIndex: 0 }))
  }, cHeaders);
  console.log(`✓ Candidate Submitted Assessment! Score: ${examSubmit.data.score}%`);

  // 5. Verify Recruiter Dashboard Evidence Synchronization & Marks Update
  const applicantsList = await axios.get(`${NODE_API}/verify/applicants?jobId=${jobId}`, rHeaders);
  const matched = applicantsList.data.find(a =>
    a.extractedEmail === candidateEmail.toLowerCase() || a.githubUsername === githubUser.toLowerCase()
  );

  console.log(`✓ Recruiter Workspace Synchronization Verification:`, {
    email: matched?.extractedEmail,
    github: matched?.githubUsername,
    status: matched?.status,
    examStatus: matched?.examStatus,
    examScore: matched?.examScore,
    alignmentScore: matched?.alignmentScore,
    finalScore: matched?.finalScore,
    rank: matched?.rank
  });

  if (!matched) {
    throw new Error("FAIL: Matched applicant was not found in recruiter applicants list!");
  }
  if (matched.status !== "Completed") {
    throw new Error(`FAIL: Recruiter applicant status was '${matched.status}' instead of 'Completed'!`);
  }
  if (matched.examStatus !== "Attended") {
    throw new Error(`FAIL: Recruiter applicant examStatus was '${matched.examStatus}' instead of 'Attended'!`);
  }
  if (matched.finalScore === undefined || matched.rank === undefined) {
    throw new Error("FAIL: Recruiter applicant finalScore or rank calculation missing!");
  }
  if (matched.examScore !== examSubmit.data.score) {
    throw new Error(`FAIL: Recruiter applicant examScore (${matched.examScore}) did not match submitted score (${examSubmit.data.score})!`);
  }

  console.log("\n=========================================================================");
  console.log("   ✅ THREE-PIPELINE EVIDENCE SHARING & MARKS SYNC TEST PASSED 100%!     ");
  console.log("=========================================================================");
}

runUserPipelineFixTest().catch(err => {
  console.error("❌ FATAL TEST ERROR:", err.stack || err.message || err);
  if (err.response) {
    console.error("Response data:", err.response.data);
  }
  process.exit(1);
});
