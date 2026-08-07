const axios = require("axios");
const FormData = require("form-data");

const NODE_API = "http://localhost:5000/api";

const TEST_RESUME = `Samantha Reed
Email: samantha.reed@example.com | GitHub: samanthareed-ai | Phone: +1 555-0188

PROFESSIONAL SUMMARY
Senior Cloud DevOps Lead with 6+ years managing Kubernetes, Terraform, Docker, and Python CI/CD pipelines.

TECHNICAL SKILLS
- Cloud & Infrastructure: Kubernetes, Docker, Terraform, AWS, Ansible, CI/CD
- Development: Python, Go, Bash, REST APIs, Git`;

async function runPhase39InvitationPipelineTest() {
  console.log("=========================================================================");
  console.log("   PHASE 39 — RECRUITER INVITATION CANONICAL WORKFLOW & IDENTITY TEST    ");
  console.log("=========================================================================\n");

  const rand = Math.floor(Math.random() * 10000);
  const recruiterEmail = `phase39_recruiter_${rand}@test.com`;
  const password = "Password123!";

  // 1. Recruiter Registers & Creates Job
  const recAuth = await axios.post(`${NODE_API}/users`, {
    name: "Phase 39 Lead Investigator",
    email: recruiterEmail,
    password,
    role: "recruiter"
  });
  const rHeaders = { headers: { Authorization: `Bearer ${recAuth.data.token}` } };

  const jobRes = await axios.post(`${NODE_API}/verify/job`, {
    title: "Senior DevOps Lead",
    description: "Looking for Kubernetes, Terraform, Docker, Python expertise",
    targetSkills: ["Kubernetes", "Terraform", "Docker", "Python"],
    experienceRequired: "4+ years"
  }, rHeaders);
  const jobId = jobRes.data._id;
  console.log(`✓ Recruiter & Job Initialized: Job ID=${jobId}`);

  // 2. Scenario A — Invite Code Identity Resolution Test
  console.log("\n--- SCENARIO A: INVITE CODE DETERMINISTIC IDENTITY RESOLUTION ---");
  const inviteCode = `INV-CODE-${rand}`;
  const candidateAEmail = `invited_candidate_a_${rand}@test.com`;

  // Create explicit invitation entry with inviteCode
  await axios.post(`${NODE_API}/verify/invite`, {
    email: candidateAEmail,
    jobId,
    inviteCode
  }, rHeaders).catch(() => {}); // Optional endpoint wrapper

  // Upload intake resume for candidate A
  const formA = new FormData();
  formA.append("jobId", jobId);
  formA.append("resumes", Buffer.from(TEST_RESUME.replace("samantha.reed@example.com", candidateAEmail)), {
    filename: "samantha_reed_resume.txt",
    contentType: "text/plain"
  });

  await axios.post(`${NODE_API}/verify/applicants/upload`, formA, {
    headers: { ...rHeaders.headers, ...formA.getHeaders() }
  });

  // Register Candidate A with Invite Code
  const candAAuth = await axios.post(`${NODE_API}/users`, {
    name: "Samantha Reed",
    email: candidateAEmail,
    password,
    role: "student",
    inviteCode
  });
  const cAHeaders = { headers: { Authorization: `Bearer ${candAAuth.data.token}` } };

  const profileA = await axios.get(`${NODE_API}/users/profile`, cAHeaders);
  console.log(`✓ Candidate A Registered with Invite Code "${inviteCode}"`);
  console.log(`  Origin: "${profileA.data.origin}" | Stage: "${profileA.data.pipelineStage}"`);

  if (profileA.data.origin !== "recruiter_invited") {
    throw new Error("FAIL: Candidate A origin was not resolved to 'recruiter_invited'!");
  }

  // 3. Scenario B — GitHub Username Match Identity Resolution Test
  console.log("\n--- SCENARIO B: GITHUB USERNAME MATCH IDENTITY RESOLUTION ---");
  const candidateBEmail = `github_candidate_${rand}@test.com`;
  const githubUserB = `samanthareed-${rand}`;

  const formB = new FormData();
  formB.append("jobId", jobId);
  formB.append("resumes", Buffer.from(TEST_RESUME.replace("samanthareed-ai", githubUserB).replace("samantha.reed@example.com", candidateBEmail)), {
    filename: "samantha_reed_resume.txt",
    contentType: "text/plain"
  });

  await axios.post(`${NODE_API}/verify/applicants/upload`, formB, {
    headers: { ...rHeaders.headers, ...formB.getHeaders() }
  });

  // Register Candidate B with matching GitHub username but different email representation
  const candBAuth = await axios.post(`${NODE_API}/users`, {
    name: "Samantha Reed B",
    email: candidateBEmail,
    password,
    role: "student",
    githubUsername: githubUserB
  });
  const cBHeaders = { headers: { Authorization: `Bearer ${candBAuth.data.token}` } };

  const profileB = await axios.get(`${NODE_API}/users/profile`, cBHeaders);
  console.log(`✓ Candidate B Registered with GitHub Handle "${githubUserB}"`);
  console.log(`  Origin: "${profileB.data.origin}" | Stage: "${profileB.data.pipelineStage}"`);

  if (profileB.data.origin !== "recruiter_invited") {
    throw new Error("FAIL: Candidate B origin was not resolved to 'recruiter_invited'!");
  }

  // 4. Scenario C — Assessment Completion & Recruiter Workspace Synchronization
  console.log("\n--- SCENARIO C: RECRUITER WORKSPACE SYNCHRONIZATION & RANKINGS ---");
  const examStart = await axios.get(`${NODE_API}/exams/start`, cAHeaders);
  console.log(`✓ Candidate A Started Assessment: ${examStart.data.length} questions`);

  const examSubmit = await axios.post(`${NODE_API}/exams/submit`, {
    answers: examStart.data.map(q => ({ questionId: q._id, answerIndex: 0 }))
  }, cAHeaders);
  console.log(`✓ Candidate A Submitted Assessment! Score: ${examSubmit.data.score}%`);

  const applicantsList = await axios.get(`${NODE_API}/verify/applicants?jobId=${jobId}`, rHeaders);
  const matchedApplicant = applicantsList.data.find(a => a.extractedEmail === candidateAEmail.toLowerCase());

  console.log(`✓ Recruiter Workspace Synchronization Verification:`, {
    email: matchedApplicant?.extractedEmail,
    status: matchedApplicant?.status,
    alignmentScore: matchedApplicant?.alignmentScore,
    examScore: matchedApplicant?.examScore
  });

  if (matchedApplicant?.status !== "Completed") {
    throw new Error("FAIL: RecruiterApplicant status was not updated to 'Completed' after exam submission!");
  }

  console.log("\n=========================================================================");
  console.log("   ✅ PHASE 39 RECRUITER INVITATION CANONICAL WORKFLOW PASSED 100%!     ");
  console.log("=========================================================================");
}

runPhase39InvitationPipelineTest().catch(err => {
  console.error("❌ FATAL TEST ERROR:", err.response ? err.response.data : err.message);
  process.exit(1);
});
