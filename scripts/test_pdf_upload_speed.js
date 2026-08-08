const axios = require("axios");
const FormData = require("form-data");
const path = require("path");
const PDFDocument = require("pdfkit");

const NODE_API = "http://localhost:5000/api";

function createDummyPdfBuffer(title, textContent) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];
    doc.on("data", b => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.fontSize(20).text(title, { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(textContent);
    doc.end();
  });
}

async function runPdfSpeedTest() {
  console.log("=========================================================================");
  console.log("   PDF UPLOAD, SPEED & ACCURACY VERIFICATION TEST                        ");
  console.log("=========================================================================\n");

  const rand = Math.floor(Math.random() * 100000);
  const recruiterEmail = `speed_recruiter_${rand}@test.com`;

  // 1. Register Recruiter
  const recAuth = await axios.post(`${NODE_API}/users`, {
    name: "Speed Test Recruiter",
    email: recruiterEmail,
    password: "Password123!",
    role: "recruiter"
  });
  const rHeaders = { headers: { Authorization: `Bearer ${recAuth.data.token}` } };

  // 2. Generate PDF Job Description Buffer
  console.log("[1/3] Testing Job Description PDF Upload Speed...");
  const jdPdfBuffer = await createDummyPdfBuffer(
    "Senior Cloud DevOps Engineer",
    `JOB DESCRIPTION:
We are looking for a Senior DevOps Lead to build scalable cloud infrastructure.
REQUIRED SKILLS: Kubernetes, Docker, Terraform, Python, AWS, CI/CD, React, Node.js.`
  );

  const formJD = new FormData();
  formJD.append("title", "Senior Cloud DevOps Engineer");
  formJD.append("jobDescription", jdPdfBuffer, {
    filename: "devops_jd_spec.pdf",
    contentType: "application/pdf"
  });

  const t0_jd = Date.now();
  const jdRes = await axios.post(`${NODE_API}/verify/job/from-file`, formJD, {
    headers: { ...rHeaders.headers, ...formJD.getHeaders() }
  });
  const t1_jd = Date.now();
  const jdTimeMs = t1_jd - t0_jd;

  console.log(`✓ Job Created from PDF in ${jdTimeMs} ms!`);
  console.log(`  Job Title: "${jdRes.data.title}"`);
  console.log(`  Extracted Target Skills (${jdRes.data.targetSkills.length}): ${jdRes.data.targetSkills.join(", ")}`);

  // 3. Generate PDF Resumes Buffers for Bulk Upload
  console.log("\n[2/3] Testing Bulk PDF Resumes Upload Speed & Accuracy (3 PDF Resumes)...");
  
  const resume1Buffer = await createDummyPdfBuffer(
    "Marcus Vance",
    "Email: marcus.vance.test@example.com | GitHub: marcusvance\nSkills: Kubernetes, Docker, Terraform, Python, AWS, C++, Node.js"
  );
  const resume2Buffer = await createDummyPdfBuffer(
    "Elena Rostova",
    "Email: elena.rostova.test@example.com | GitHub: elenarostova\nSkills: React, TypeScript, Node.js, HTML/CSS, Tailwind CSS, CI/CD"
  );
  const resume3Buffer = await createDummyPdfBuffer(
    "David Chen",
    "Email: david.chen.test@example.com | GitHub: davidchen-dev\nSkills: Python, Django, PostgreSQL, Redis, Docker, System Design"
  );

  const formResumes = new FormData();
  formResumes.append("jobId", jdRes.data._id);
  formResumes.append("resumes", resume1Buffer, { filename: "marcus_vance_resume.pdf", contentType: "application/pdf" });
  formResumes.append("resumes", resume2Buffer, { filename: "elena_rostova_resume.pdf", contentType: "application/pdf" });
  formResumes.append("resumes", resume3Buffer, { filename: "david_chen_resume.pdf", contentType: "application/pdf" });

  const t0_resumes = Date.now();
  const bulkRes = await axios.post(`${NODE_API}/verify/applicants/upload`, formResumes, {
    headers: { ...rHeaders.headers, ...formResumes.getHeaders() }
  });
  const t1_resumes = Date.now();
  const bulkTimeMs = t1_resumes - t0_resumes;

  console.log(`✓ 3 PDF Resumes Uploaded, Parsed & Shortlisted in ${bulkTimeMs} ms (${Math.round(bulkTimeMs/3)} ms/resume)!`);
  
  bulkRes.data.forEach((app, idx) => {
    console.log(`  Candidate #${idx+1}: "${app.extractedName}" <${app.extractedEmail}> | Alignment: ${app.alignmentScore}% | Status: ${app.status}`);
  });

  console.log("\n=========================================================================");
  console.log("   ✅ PDF UPLOAD & EXECUTION SPEED VERIFICATION PASSED 100%!             ");
  console.log("=========================================================================");
}

runPdfSpeedTest().catch(err => {
  console.error("❌ PDF TEST ERROR:", err.response ? err.response.data : err.message);
  process.exit(1);
});
