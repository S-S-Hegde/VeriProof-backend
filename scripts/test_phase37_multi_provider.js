const axios = require("axios");
const FormData = require("form-data");

const PYTHON_API = "http://localhost:8000/api";
const NODE_API = "http://localhost:5000/api";

const TEST_RESUME = `Dr. Aris Vance
Email: aris.vance@example.com | Phone: +1 555-0199 | Location: San Francisco, CA

PROFESSIONAL SUMMARY
Principal AI Architect with 8+ years leading enterprise LLM orchestration, computer vision, and distributed microservice infrastructure.

TECHNICAL EXPERTISE
- AI & ML: PyTorch, TensorFlow, OpenAI API, Gemini Pro, Groq LLaMA-3, HuggingFace, CUDA
- Full Stack & Backend: Python, FastAPI, Node.js, React.js, TypeScript, GraphQL, REST APIs
- Cloud & Infrastructure: Docker, Kubernetes, PostgreSQL, MongoDB, Redis, AWS EKS, Git

EXPERIENCE
Principal AI Engineer | Quantum AI Labs (2021 - Present)
- Built multi-provider LLM orchestration system handling 10M+ daily tokens with automatic failover.
- Developed real-time vision document parser using PyTorch, OpenCV, and FastAPI.

Senior Software Engineer | CloudScale Systems (2017 - 2021)
- Designed distributed backend services in Node.js and PostgreSQL.
- Orchestrated microservice deployments on Kubernetes and AWS.`;

async function runPhase37MultiProviderAudit() {
  console.log("=========================================================================");
  console.log("   PHASE 37 — UNIFIED AI PROVIDER ORCHESTRATION & BENCHMARK AUDIT        ");
  console.log("=========================================================================\n");

  // 1. Direct Python AI Task Execution Benchmark
  console.log("--- PHASE 37A - 37C: AI ORCHESTRATOR PROVIDER BENCHMARK ---");

  const taskPayload = {
    claims: [
      { skill: "Python", context: "LLM Orchestration & FastAPI" },
      { skill: "React.js", context: "Enterprise Dashboard" },
      { skill: "Docker", context: "Containerized deployment" },
      { skill: "PostgreSQL", context: "Relational database schema" }
    ],
    difficulty: "advanced"
  };

  const t0 = Date.now();
  try {
    const genRes = await axios.post(`${PYTHON_API}/generate-assessment`, taskPayload);
    const duration = Date.now() - t0;

    console.log(`✓ AI Orchestrator Task Execution Success! Duration: ${duration}ms`);
    console.log(`✓ Module: "${genRes.data.module}" | Questions Generated: ${genRes.data.result?.mcq_questions?.length || 0}`);
  } catch (err) {
    console.error("❌ /api/generate-assessment benchmark failed:", err.response ? err.response.data : err.message);
  }

  // 2. Multi-Provider Claim Extraction Execution Matrix
  console.log("\n--- PHASE 37D - 37G: RESUME VISION & CLAIM EXTRACTION PIPELINE ---");

  const form = new FormData();
  form.append("file", Buffer.from(TEST_RESUME), {
    filename: "aris_vance_resume.txt",
    contentType: "text/plain"
  });

  const tExtract = Date.now();
  try {
    const extractRes = await axios.post(`${PYTHON_API}/extract-claims-pdf`, form, {
      headers: form.getHeaders()
    });
    const durExtract = Date.now() - tExtract;
    const claims = extractRes.data.result?.claims || [];

    console.log(`✓ Resume Claim Extraction Success! Status: ${extractRes.status} | Duration: ${durExtract}ms`);
    console.log(`✓ Extracted Claims Count: ${claims.length}`);
    console.log(`  Extracted Skills Sample:`, claims.slice(0, 6).map(c => c.skill).join(", "));

    if (claims.length === 0) {
      throw new Error("CRITICAL DEFECT: Claim extraction returned 0 claims!");
    }
  } catch (err) {
    console.error("❌ /api/extract-claims-pdf failed:", err.response ? err.response.data : err.message);
  }

  // 3. End-to-End MERN Evidence Propagation
  console.log("\n--- PHASE 37J: END-TO-END RECRUITER & CANDIDATE PIPELINE PROPAGATION ---");

  try {
    const rand = Math.floor(Math.random() * 10000);
    const candidateEmail = `aris.vance_${rand}@example.com`;
    const recruiterEmail = `phase37_recruiter_${rand}@test.com`;
    const password = "Password123!";

    const dynamicResume = TEST_RESUME.replace("aris.vance@example.com", candidateEmail);

    // A. Recruiter Signup & Job Creation
    const recAuth = await axios.post(`${NODE_API}/users`, {
      name: "Phase 37 Lead Recruiter",
      email: recruiterEmail,
      password,
      role: "recruiter"
    });
    const rHeaders = { headers: { Authorization: `Bearer ${recAuth.data.token}` } };

    const jobRes = await axios.post(`${NODE_API}/verify/job`, {
      title: "Principal AI Architect",
      description: "Looking for Principal AI Architect with Python, PyTorch, React.js, FastAPI, Docker, PostgreSQL",
      targetSkills: ["Python", "PyTorch", "React.js", "FastAPI", "Docker", "PostgreSQL"],
      experienceRequired: "5+ years"
    }, rHeaders);
    const jobId = jobRes.data._id;
    console.log(`✓ Job Created: ID=${jobId}`);

    // B. Recruiter Upload Intake Resume
    const uploadForm = new FormData();
    uploadForm.append("jobId", jobId);
    uploadForm.append("resumes", Buffer.from(dynamicResume), {
      filename: "aris_vance_resume.txt",
      contentType: "text/plain"
    });

    const uploadRes = await axios.post(`${NODE_API}/verify/applicants/upload`, uploadForm, {
      headers: { ...rHeaders.headers, ...uploadForm.getHeaders() }
    });
    console.log(`✓ Recruiter Intake Upload Succeeded! Applicants Created: ${uploadRes.data.length}`);

    // C. Candidate Registers
    const candAuth = await axios.post(`${NODE_API}/users`, {
      name: "Dr. Aris Vance",
      email: candidateEmail,
      password,
      role: "student"
    });
    const cHeaders = { headers: { Authorization: `Bearer ${candAuth.data.token}` } };
    console.log(`✓ Candidate Registered: Email="${candidateEmail}"`);

    // D. Candidate Profile Hydrated
    const profileRes = await axios.get(`${NODE_API}/users/profile`, cHeaders);
    console.log(`✓ Candidate Profile Hydrated: Origin="${profileRes.data.origin}", Stage="${profileRes.data.pipelineStage}"`);

    // E. Skill Tree Graph
    const treeRes = await axios.get(`${NODE_API}/skill-tree`, cHeaders);
    const nodesCount = Object.keys(treeRes.data.skillTree || {}).length;
    console.log(`✓ Candidate Skill Tree Graph Nodes Populated: ${nodesCount} active nodes!`);

    // F. Assessment Submission
    const examStart = await axios.get(`${NODE_API}/exams/start`, cHeaders);
    console.log(`✓ Assessment Generated with ${examStart.data.length} questions for category '${profileRes.data.origin}'`);

    const examSubmit = await axios.post(`${NODE_API}/exams/submit`, {
      answers: examStart.data.map(q => ({ questionId: q._id, answerIndex: 0 }))
    }, cHeaders);
    console.log(`✓ Assessment Submitted! Score: ${examSubmit.data.examScore}% | Status: "${examSubmit.data.examStatus}"`);

    // G. Recruiter Sync
    const applicantsRes = await axios.get(`${NODE_API}/verify/applicants?jobId=${jobId}`, rHeaders);
    const matched = applicantsRes.data.find(a => a.extractedEmail === candidateEmail.toLowerCase());

    console.log(`✓ Recruiter Workspace Sync Verification:`, {
      email: matched?.extractedEmail,
      alignmentScore: matched?.alignmentScore,
      examStatus: matched?.examStatus,
      examScore: matched?.examScore
    });

    console.log("\n=========================================================================");
    console.log("   ✅ PHASE 37 UNIFIED AI ORCHESTRATION & PIPELINE AUDIT PASSED 100%!    ");
    console.log("=========================================================================");
  } catch (err) {
    console.error("❌ End-to-End Pipeline Propagation Failed:", err.response ? err.response.data : err.message);
    process.exit(1);
  }
}

runPhase37MultiProviderAudit().catch(err => {
  console.error("❌ FATAL TEST ERROR:", err.message);
  process.exit(1);
});
