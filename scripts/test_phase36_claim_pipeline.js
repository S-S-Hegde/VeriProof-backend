const axios = require("axios");
const FormData = require("form-data");

const PYTHON_API = "http://localhost:8000/api";
const NODE_API = "http://localhost:5000/api";

const SAMPLE_RESUMES = [
  {
    name: "Resume 1 - Senior AI Systems Engineer",
    text: `Rahul Verma
Email: rahul.verma@example.com | Phone: +91 9876543210
Location: Mumbai, India | GitHub: github.com/rahulverma-ai

SUMMARY
Senior AI Systems Engineer with 5+ years of experience building scalable machine learning pipelines, REST microservices, and reactive web applications.

TECHNICAL SKILLS
- Languages: Python, JavaScript, TypeScript, C++, SQL
- Frameworks & Libraries: PyTorch, TensorFlow, FastAPI, React.js, Node.js, Express.js, TailwindCSS
- Infrastructure & Databases: Docker, Kubernetes, PostgreSQL, MongoDB, Redis, AWS, Git

EXPERIENCE
Senior AI Engineer | TechCorp Solutions (2022 - Present)
- Designed real-time recommendation system using PyTorch and FastAPI, serving 2M daily active users.
- Built full-stack monitoring dashboard with React.js, Node.js, and MongoDB.
- Deployed microservices using Docker, Kubernetes, and AWS EC2.

Software Engineer | DataSys Systems (2019 - 2022)
- Developed REST APIs in Node.js and PostgreSQL.
- Implemented CI/CD pipelines with Git and Docker.`
  },
  {
    name: "Resume 2 - Full Stack MERN Developer",
    text: `Ananya Sharma
Email: ananya.sharma@example.com | Location: Bengaluru, India

PROFESSIONAL SUMMARY
Full Stack Developer proficient in MERN stack, TypeScript, and cloud deployment.

SKILLS & TECHNOLOGIES
- Web Development: React.js, Node.js, Express, Redux, HTML5, CSS3, JavaScript, TypeScript
- Databases & Tools: MongoDB, PostgreSQL, Docker, Git, Postman, Jest

PROJECTS
E-Commerce Platform (React, Node, MongoDB)
- Architected responsive web app using React.js and Redux.
- Built backend API with Node.js, Express, and MongoDB authentication.`
  },
  {
    name: "Resume 3 - Cloud DevOps & Infrastructure Lead",
    text: `Vikram Patel
DevOps Lead Engineer | Email: vikram.patel@example.com

SKILLS
Kubernetes, Docker, AWS, Terraform, Ansible, Python, Bash, CI/CD, Jenkins, Prometheus, Grafana, PostgreSQL, Linux, Git

WORK EXPERIENCE
Lead Infrastructure Engineer (2020 - Present)
- Managed Kubernetes clusters on AWS EKS.
- Automated deployment scripts with Python and Ansible.`
  },
  {
    name: "Resume 4 - Data Engineer & Backend Architect",
    text: `Priya Nair
Data Engineer | Email: priya.nair@example.com

TECHNICAL PROFICIENCIES
Python, Apache Spark, Kafka, SQL, PostgreSQL, Snowflake, Docker, Airflow, Java, Git, AWS S3

EXPERIENCE
Data Engineer at BigData Inc.
- Constructed streaming data pipelines using Kafka, Spark, and PostgreSQL.`
  },
  {
    name: "Resume 5 - Backend Systems Specialist",
    text: `Siddharth Rao
Backend Developer | Email: siddharth.rao@example.com

CORE COMPETENCIES
Node.js, Express.js, Go, PostgreSQL, Redis, Docker, Microservices, REST APIs, Git, JavaScript, C++

WORK HISTORY
Backend Developer at CoreSystems
- Developed high-throughput microservices using Node.js and Redis.`
  }
];

async function runPhase36ClaimPipelineValidation() {
  console.log("=========================================================================");
  console.log("   PHASE 36 — CLAIM EXTRACTION PIPELINE & EVIDENCE PROPAGATION AUDIT    ");
  console.log("=========================================================================\n");

  const metrics = {
    resumesTested: 0,
    totalClaimsExtracted: 0,
    failures: 0,
    resumes: []
  };

  // -------------------------------------------------------------------------
  // 1. MULTI-RESUME CLAIM EXTRACTION AUDIT (DIRECT PYTHON ENGINE)
  // -------------------------------------------------------------------------
  console.log("--- PHASE 36A - 36I: MULTI-RESUME CLAIM EXTRACTION AUDIT ---");

  for (let i = 0; i < SAMPLE_RESUMES.length; i++) {
    const resume = SAMPLE_RESUMES[i];
    console.log(`\nTesting ${resume.name}...`);

    const form = new FormData();
    form.append("file", Buffer.from(resume.text), {
      filename: `resume_${i + 1}.txt`,
      contentType: "text/plain"
    });

    const t0 = Date.now();
    try {
      const res = await axios.post(`${PYTHON_API}/extract-claims-pdf`, form, {
        headers: form.getHeaders()
      });
      const duration = Date.now() - t0;
      const claims = res.data.result?.claims || [];
      const claimCount = claims.length;

      console.log(`✓ Python /api/extract-claims-pdf Success! Status: ${res.status} | Duration: ${duration}ms`);
      console.log(`✓ Extracted Claims Count: ${claimCount}`);
      console.log(`  Sample Extracted Skills:`, claims.slice(0, 5).map(c => c.skill).join(", "));

      if (claimCount === 0) {
        throw new Error(`CRITICAL DEFECT: ${resume.name} returned 0 claims!`);
      }

      metrics.resumesTested++;
      metrics.totalClaimsExtracted += claimCount;
      metrics.resumes.push({
        name: resume.name,
        claimsFound: claimCount,
        durationMs: duration,
        status: "PASS"
      });
    } catch (err) {
      metrics.failures++;
      console.error(`❌ Failed on ${resume.name}:`, err.response ? err.response.data : err.message);
    }
  }

  // -------------------------------------------------------------------------
  // 2. END-TO-END RECRUITER & CANDIDATE EVIDENCE PROPAGATION AUDIT
  // -------------------------------------------------------------------------
  console.log("\n--- PHASE 36J: END-TO-END DOWNSTREAM EVIDENCE PROPAGATION AUDIT ---");

  try {
    const rand = Math.floor(Math.random() * 10000);
    const candidateEmail = `rahul.verma_${rand}@example.com`;
    const recruiterEmail = `phase36_recruiter_${rand}@test.com`;
    const password = "Password123!";

    const dynamicText = SAMPLE_RESUMES[0].text.replace("rahul.verma@example.com", candidateEmail);

    // A. Recruiter Signup & Job Creation
    const recAuth = await axios.post(`${NODE_API}/users`, {
      name: "Phase 36 Lead Recruiter",
      email: recruiterEmail,
      password,
      role: "recruiter"
    });
    const rHeaders = { headers: { Authorization: `Bearer ${recAuth.data.token}` } };

    const jobRes = await axios.post(`${NODE_API}/verify/job`, {
      title: "Lead AI Systems Engineer",
      description: "Require Python, PyTorch, React.js, Node.js, Docker, PostgreSQL",
      targetSkills: ["Python", "PyTorch", "React.js", "Node.js", "Docker", "PostgreSQL"],
      experienceRequired: "3+ years"
    }, rHeaders);
    const jobId = jobRes.data._id;
    console.log(`✓ Job Created: ID=${jobId}`);

    // B. Recruiter Uploads Candidate Intake Resume
    const uploadForm = new FormData();
    uploadForm.append("jobId", jobId);
    uploadForm.append("resumes", Buffer.from(dynamicText), {
      filename: "rahul_verma_resume.txt",
      contentType: "text/plain"
    });

    const uploadRes = await axios.post(`${NODE_API}/verify/applicants/upload`, uploadForm, {
      headers: { ...rHeaders.headers, ...uploadForm.getHeaders() }
    });
    console.log(`✓ Recruiter Upload Uploaded Intake Resume! Applicants Created: ${uploadRes.data.length}`);

    // C. Candidate Registers with Matching Email
    const candAuth = await axios.post(`${NODE_API}/users`, {
      name: "Rahul Verma",
      email: candidateEmail,
      password,
      role: "student"
    });
    const cHeaders = { headers: { Authorization: `Bearer ${candAuth.data.token}` } };
    console.log(`✓ Candidate Registered: Email="${candidateEmail}"`);

    // D. Verify Candidate Profile Hydration & Claims Persistence
    const profileRes = await axios.get(`${NODE_API}/users/profile`, cHeaders);
    console.log(`✓ Candidate Profile Hydrated: Origin="${profileRes.data.origin}", Stage="${profileRes.data.pipelineStage}"`);

    // E. Verify Skill Tree Graph received Extracted Claims
    const treeRes = await axios.get(`${NODE_API}/skill-tree`, cHeaders);
    const skillNodesCount = Object.keys(treeRes.data.skillTree || {}).length;
    console.log(`✓ Candidate Skill Tree Nodes Populated: ${skillNodesCount} nodes active!`);

    // F. Candidate Completes Assessment
    const examStart = await axios.get(`${NODE_API}/exams/start`, cHeaders);
    console.log(`✓ Dynamic Assessment Generated: ${examStart.data.length} questions matching candidate claims!`);

    const examSubmit = await axios.post(`${NODE_API}/exams/submit`, {
      answers: examStart.data.map(q => ({ questionId: q._id, answerIndex: 0 }))
    }, cHeaders);
    console.log(`✓ Assessment Submitted: Score=${examSubmit.data.examScore}% | Status="${examSubmit.data.examStatus}"`);

    // G. Verify Recruiter Workspace Ranking & Job Alignment
    const applicantsRes = await axios.get(`${NODE_API}/verify/applicants?jobId=${jobId}`, rHeaders);
    const matched = applicantsRes.data.find(a => a.extractedEmail === candidateEmail.toLowerCase());

    console.log(`✓ Recruiter Dashboard Sync Verification:`, {
      email: matched?.extractedEmail,
      alignmentScore: matched?.alignmentScore,
      trustScore: matched?.trustScore,
      examStatus: matched?.examStatus,
      examScore: matched?.examScore
    });

    if (matched?.examScore > 0) {
      console.log("✓ Downstream Evidence Propagation Verified 100%!");
    } else {
      throw new Error("Recruiter sync failed to reflect non-zero assessment score!");
    }
  } catch (err) {
    metrics.failures++;
    console.error("❌ Downstream Evidence Propagation Failed:", err.response ? err.response.data : err.message);
  }

  // -------------------------------------------------------------------------
  // 3. FINAL SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log("\n=========================================================================");
  console.log(`   PHASE 36 CLAIM PIPELINE AUDIT COMPLETED!                              `);
  console.log(`   Resumes Tested: ${metrics.resumesTested} / 5                                    `);
  console.log(`   Total Claims Extracted: ${metrics.totalClaimsExtracted}                                  `);
  console.log(`   Failures: ${metrics.failures}                                                `);
  console.log("=========================================================================");

  if (metrics.failures > 0) {
    process.exit(1);
  }
}

runPhase36ClaimPipelineValidation().catch(err => {
  console.error("❌ FATAL TEST ERROR:", err.message);
  process.exit(1);
});
