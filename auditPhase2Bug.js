const mongoose = require("mongoose");
const fs = require("fs");
const Exam = require("./models/Exam");
require("dotenv").config();

async function runAudit() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("[Audit] Connected to MongoDB.");

    // Find exams that contain answers with an "undefined" or null questionId
    const affectedExams = await Exam.find({
      $or: [
        { "answers.questionId": "undefined" },
        { "answers.questionId": null }
      ]
    }).lean();

    console.log(`[Audit] Found ${affectedExams.length} affected exam documents.`);
    
    const report = affectedExams.map(exam => ({
      examId: exam._id,
      candidateId: exam.candidateId,
      status: exam.status,
      submittedAt: exam.submittedAt || exam.updatedAt,
      adaptiveScore: exam.adaptiveScore,
      totalScore: exam.score,
      affectedAnswerCount: exam.answers.filter(a => !a.questionId || String(a.questionId) === "undefined").length
    }));

    // Output a markdown report directly
    let md = `# Phase 2 Integrity Audit Report\n\n`;
    md += `**Bug identified:** Phase 2 questions were missing \`_id\` assignments at generation, causing the frontend to store answers under the key \`"undefined"\`. This resulted in subsequent Phase 2 questions appearing pre-selected with the first answer given, and all Phase 2 questions receiving a score of 0 due to an ID mismatch during calculation.\n\n`;
    md += `## Affected Documents (${report.length})\n\n`;
    
    if (report.length > 0) {
      md += `| Exam ID | Candidate ID | Status | Submitted | Adaptive Score | Affected Answers |\n`;
      md += `|---------|--------------|--------|-----------|----------------|------------------|\n`;
      report.forEach(r => {
        md += `| \`${r.examId}\` | \`${r.candidateId}\` | ${r.status} | ${new Date(r.submittedAt).toLocaleString()} | ${r.adaptiveScore} | ${r.affectedAnswerCount} |\n`;
      });
    } else {
      md += `*No affected exams found in the database.*`;
    }

    fs.writeFileSync("C:/Users/shrid/.gemini/antigravity-ide/brain/18ecc875-3491-4b98-a9d5-9e8759b726ab/phase_2_audit_report.md", md);
    console.log("[Audit] Wrote phase_2_audit_report.md successfully.");
    process.exit(0);
  } catch (err) {
    console.error("[Audit] Error:", err);
    process.exit(1);
  }
}

runAudit();
