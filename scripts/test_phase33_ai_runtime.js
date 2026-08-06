const axios = require("axios");
const FormData = require("form-data");
const PYTHON_API = "http://localhost:8000/api";
const NODE_API = "http://localhost:5000/api";

async function testPhase33AIRuntime() {
  console.log("--- PHASE 33 PYTHON AI RUNTIME RESTORATION INTEGRATION TEST ---");

  // 1. Test Python /api/extract-claims-pdf direct call
  console.log("1. Testing Python /api/extract-claims-pdf endpoint...");
  const form = new FormData();
  const dummyResume = `Aarav Sharma - Senior Full Stack Software Engineer
Email: aarav.sharma@example.com
Phone: +91 9876543210
Location: Bengaluru, India
GitHub: https://github.com/aaravsharma-dev

PROFESSIONAL SUMMARY
Experienced Full Stack Engineer with 5+ years of expertise in building scalable MERN stack web applications, microservices, and AI-driven automation systems.

TECHNICAL SKILLS
- Languages: JavaScript, TypeScript, Python, SQL
- Frontend: React.js, Next.js, Redux Toolkit, Tailwind CSS
- Backend: Node.js, Express.js, FastAPI, RESTful APIs
- Databases: MongoDB, PostgreSQL, Redis
- DevOps & Tools: Docker, AWS, Git, CI/CD Pipelines

PROJECTS
1. E-Commerce Platform (React, Node.js, MongoDB)
   - Architected high-throughput checkout microservice serving 100k daily active users.
2. AI Document Processor (Python, FastAPI, Gemini AI)
   - Developed automated PDF claim extraction pipeline with 98% accuracy.`;

  form.append("file", Buffer.from(dummyResume), {
    filename: "aarav_resume.txt",
    contentType: "text/plain"
  });

  const pdfRes = await axios.post(`${PYTHON_API}/extract-claims-pdf`, form, {
    headers: form.getHeaders()
  });

  console.log(`✓ /api/extract-claims-pdf Status: ${pdfRes.status}`);
  console.log(`✓ Extracted Claims Count: ${pdfRes.data.result?.extracted_claims?.length || pdfRes.data.result?.length || 0}`);

  // 2. Test Python /api/verify-claims direct call
  console.log("2. Testing Python /api/verify-claims endpoint...");
  const verifyRes = await axios.post(`${PYTHON_API}/verify-claims`, {
    claims: ["React", "Node.js", "MongoDB", "Python", "Docker"],
    job_requirements: ["React", "Node.js", "Python"]
  });

  console.log(`✓ /api/verify-claims Status: ${verifyRes.status}`);
  console.log(`✓ Verification Summary:`, verifyRes.data.summary);

  // 3. Test Python /api/generate-assessment direct call
  console.log("3. Testing Python /api/generate-assessment endpoint...");
  const genRes = await axios.post(`${PYTHON_API}/generate-assessment`, {
    claims: [
      { skill: "React", context: "Frontend development" },
      { skill: "Node.js", context: "Backend development" }
    ],
    difficulty: "intermediate"
  });

  console.log(`✓ /api/generate-assessment Status: ${genRes.status}`);
  console.log(`✓ Generated MCQs Count: ${genRes.data.result?.mcq_questions?.length || 0}`);

  // 4. Test Recruiter Applicant Upload in Node API to verify single invite & card count
  console.log("4. Testing Recruiter Upload Applicant count consistency (1 upload = 1 record)...");
  const recruiterAuth = await axios.post(`${NODE_API}/users/login`, {
    email: "recruiter_test@test.com",
    password: "Password123!"
  }).catch(async () => {
    const signup = await axios.post(`${NODE_API}/users`, {
      name: "Recruiter Tester",
      email: "recruiter_test@test.com",
      password: "Password123!",
      role: "recruiter"
    });
    return signup;
  });

  const recruiterToken = recruiterAuth.data.token;
  const recruiterHeader = { headers: { Authorization: `Bearer ${recruiterToken}` } };

  // Create job role
  const jobRes = await axios.post(`${NODE_API}/verify/job`, {
    title: "Phase 33 Full Stack Engineer",
    description: "Test job role description for Phase 33 upload verification",
    targetSkills: ["React", "Node.js", "Python"],
    experienceRequired: "3+ years"
  }, recruiterHeader);

  const jobId = jobRes.data._id;

  // Upload 2 resumes
  const uploadForm = new FormData();
  uploadForm.append("jobId", jobId);
  uploadForm.append("resumes", Buffer.from("Candidate One\nEmail: cand1@test.com\nSkills: React"), { filename: "cand1.txt" });
  uploadForm.append("resumes", Buffer.from("Candidate Two\nEmail: cand2@test.com\nSkills: Node.js"), { filename: "cand2.txt" });

  const uploadRes = await axios.post(`${NODE_API}/verify/applicants/upload`, uploadForm, {
    headers: { ...recruiterHeader.headers, ...uploadForm.getHeaders() }
  });

  console.log(`✓ Upload API Response Array Length: ${uploadRes.data.length} (Expected: 2)`);
  if (uploadRes.data.length !== 2) {
    throw new Error(`FAILED: Upload API returned ${uploadRes.data.length} items for 2 files! Duplicate entries exist!`);
  }
  console.log("✓ Upload Card & Invite Count EXACT MATCH: 2 uploads = 2 response entries!");

  console.log("✅ PHASE 33 PYTHON AI RUNTIME & UPLOAD CONSISTENCY TEST PASSED 100%!");
}

testPhase33AIRuntime().catch(err => {
  console.error("❌ TEST FAILED:", err.response ? err.response.data : err.message);
  process.exit(1);
});
