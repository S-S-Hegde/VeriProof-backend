require('dotenv').config();
const { analyzeResumeBuffer } = require('./services/resumeIntelligenceService');

const sampleText = [
  "John Doe",
  "johndoe@gmail.com | +91 9876543210",
  "",
  "SKILLS",
  "Languages: JavaScript, TypeScript, Python",
  "Frontend: React, Next.js, Tailwind CSS",
  "Backend: Node.js, Express, REST API",
  "Database: MongoDB, PostgreSQL, Redis",
  "DevOps: Docker, GitHub Actions, AWS",
].join("\n");

const buf = Buffer.from(sampleText);

analyzeResumeBuffer(buf, { mimeType: "text/plain" })
  .then(r => {
    console.log("=== RESULT ===");
    console.log("Name:   ", r.analysis.name);
    console.log("Email:  ", r.analysis.email);
    console.log("Source: ", r.analysis.extractionSource);
    console.log("Skills: ", r.claims.skills.join(", "));
    process.exit(0);
  })
  .catch(e => {
    console.error("ERROR:", e.message);
    process.exit(1);
  });
