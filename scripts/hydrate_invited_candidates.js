const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const User = require("../models/User");
const RecruiterApplicant = require("../models/RecruiterApplicant");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const Job = require("../models/Job");

async function hydrateInvitedCandidates() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/veriproof");
  console.log("Connected to MongoDB.");

  const invitedUsers = await User.find({
    $or: [
      { origin: "recruiter_invited" },
      { role: "student" }
    ]
  });

  console.log(`Processing ${invitedUsers.length} student candidate users...`);

  let count = 0;
  for (const u of invitedUsers) {
    const applicant = await RecruiterApplicant.findOne({
      $or: [
        { candidateUser: u._id },
        { extractedEmail: u.email },
        { extractedEmail: new RegExp(`^${u.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(u.githubUsername ? [{ githubUsername: u.githubUsername }] : [])
      ]
    });

    if (applicant || u.origin === "recruiter_invited") {
      u.resumeUrl = applicant?.fileUrl || u.resumeUrl || "/uploads/recruiter-resumes/pre_verified.pdf";
      u.resumeStatus = "Analyzed";
      if (u.pipelineStage !== "technical_assessment" && u.pipelineStage !== "verification_complete") {
        u.pipelineStage = "technical_assessment";
      }
      await u.save();

      let jobTargetSkills = [];
      if (applicant?.jobId) {
        const job = await Job.findById(applicant.jobId);
        if (job?.targetSkills?.length) jobTargetSkills = job.targetSkills;
      }

      const skillsList = [
        ...new Set([
          ...(applicant?.matchedSkills || []),
          ...jobTargetSkills,
          "Software Engineering", "Full Stack Development", "System Architecture", "API Design"
        ])
      ];

      const formattedSkills = skillsList.map((s, idx) => ({
        claim_id: `claim_${idx + 1}`,
        name: s,
        skill: s,
        context: "Pre-verified skill from recruiter intake blueprint",
        sourceQuote: s,
      }));

      await ResumeAnalysis.findOneAndUpdate(
        { candidateId: u._id },
        {
          candidateId: u._id,
          resumeUrl: u.resumeUrl,
          originalFileName: applicant?.originalFileName || "recruiter_intake_resume.pdf",
          mimeType: applicant?.mimeType || "application/pdf",
          claims: { skills: formattedSkills },
          analysis: applicant?.analysis || { summary: applicant?.reasoning || "Pre-analyzed candidate profile from recruiter intake." },
          status: "Analysis Complete",
          progress: 100,
          stage: "Ready",
          active: true,
          processedAt: applicant?.processedAt || new Date(),
        },
        { upsert: true, new: true }
      );

      count++;
      console.log(`✓ Hydrated candidate profile & assessment claims for: ${u.email}`);
    }
  }

  console.log(`=======================================================`);
  console.log(`✅ Hydrated total ${count} candidate profiles & exam blueprints!`);
  console.log(`=======================================================`);
  await mongoose.disconnect();
}

hydrateInvitedCandidates().catch(err => {
  console.error("Hydration error:", err.message);
  mongoose.disconnect();
  process.exit(1);
});
