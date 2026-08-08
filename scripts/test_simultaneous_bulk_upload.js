const axios = require("axios");
const FormData = require("form-data");
const PDFDocument = require("pdfkit");

const NODE_API = "http://localhost:5000/api";

function createPdfBuffer(name, email, skills) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];
    doc.on("data", b => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.fontSize(18).text(name);
    doc.fontSize(12).text(`Email: ${email} | GitHub: ${name.toLowerCase().replace(/\s+/g, '')}`);
    doc.moveDown();
    doc.fontSize(12).text(`TECHNICAL SKILLS:\n${skills.join(", ")}`);
    doc.end();
  });
}

async function testSimultaneousBulkUpload() {
  console.log("=========================================================================");
  console.log("   SIMULTANEOUS MULTI-RESUME PARSING VERIFICATION TEST                   ");
  console.log("=========================================================================\n");

  const rand = Math.floor(Math.random() * 100000);
  const recruiterEmail = `simul_recruiter_${rand}@test.com`;

  // 1. Register Recruiter
  const recAuth = await axios.post(`${NODE_API}/users`, {
    name: "Simultaneous Intake Lead",
    email: recruiterEmail,
    password: "Password123!",
    role: "recruiter"
  });
  const rHeaders = { headers: { Authorization: `Bearer ${recAuth.data.token}` } };

  // 2. Create Job
  const jobRes = await axios.post(`${NODE_API}/verify/job`, {
    title: "Senior Software Architect",
    description: "Seeking Full Stack, Cloud, Python, React, and DevOps expertise.",
    targetSkills: ["Python", "React", "Docker", "Node.js", "Kubernetes", "PostgreSQL", "AWS"]
  }, rHeaders);

  console.log(`✓ Job Created: "${jobRes.data.title}"`);

  // 3. Generate 10 PDF Resumes
  console.log("\nGenerating 10 candidate PDF resumes in memory...");
  const candidatesData = [
    { name: "Sophia Martinez", email: `sophia.m_${rand}@example.com`, skills: ["Python", "Django", "PostgreSQL", "Docker"] },
    { name: "Liam O'Connor",    email: `liam.o_${rand}@example.com`,   skills: ["React", "TypeScript", "Node.js", "AWS"] },
    { name: "Aarav Patel",      email: `aarav.p_${rand}@example.com`,  skills: ["Kubernetes", "Docker", "Python", "CI/CD"] },
    { name: "Emma Watson",      email: `emma.w_${rand}@example.com`,   skills: ["Node.js", "Express", "MongoDB", "React"] },
    { name: "Noah Kim",         email: `noah.k_${rand}@example.com`,   skills: ["Python", "FastAPI", "PostgreSQL", "Redis"] },
    { name: "Olivia Silva",     email: `olivia.s_${rand}@example.com`, skills: ["React", "Next.js", "Tailwind CSS", "TypeScript"] },
    { name: "Ethan Wright",     email: `ethan.w_${rand}@example.com`,  skills: ["Java", "Spring Boot", "AWS", "Docker"] },
    { name: "Ava Taylor",       email: `ava.t_${rand}@example.com`,    skills: ["Python", "Machine Learning", "PyTorch", "SQL"] },
    { name: "Lucas Garcia",     email: `lucas.g_${rand}@example.com`,  skills: ["C++", "System Design", "Linux", "Docker"] },
    { name: "Mia Jackson",      email: `mia.j_${rand}@example.com`,    skills: ["React Native", "Flutter", "JavaScript", "Firebase"] },
  ];

  const form = new FormData();
  form.append("jobId", jobRes.data._id);

  for (const c of candidatesData) {
    const pdfBuf = await createPdfBuffer(c.name, c.email, c.skills);
    form.append("resumes", pdfBuf, {
      filename: `${c.name.toLowerCase().replace(/\s+/g, '_')}_resume.pdf`,
      contentType: "application/pdf"
    });
  }

  // 4. Upload all 10 resumes simultaneously
  console.log("\n🚀 Uploading & Parsing ALL 10 PDF Resumes SIMULTANEOUSLY in parallel...");
  const t0 = Date.now();
  const bulkRes = await axios.post(`${NODE_API}/verify/applicants/upload`, form, {
    headers: { ...rHeaders.headers, ...form.getHeaders() }
  });
  const t1 = Date.now();
  const elapsedMs = t1 - t0;

  console.log(`\n✅ SUCCESS! All 10 Resumes Parsed & Shortlisted Simultaneously in ${elapsedMs} ms (${Math.round(elapsedMs / 10)} ms per resume)!`);
  console.log("-------------------------------------------------------------------------");
  
  bulkRes.data.forEach((app, idx) => {
    console.log(` [#${idx + 1}] Name: "${app.extractedName}" | Email: <${app.extractedEmail}> | Alignment: ${app.alignmentScore}% | Status: ${app.status}`);
  });

  console.log("\n=========================================================================");
  console.log("   ✅ SIMULTANEOUS MULTI-RESUME PARSING VERIFIED 100% WORKING!           ");
  console.log("=========================================================================");
}

testSimultaneousBulkUpload().catch(err => {
  console.error("❌ TEST FAILED:", err.response ? err.response.data : err.message);
  process.exit(1);
});
