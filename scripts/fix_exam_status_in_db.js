const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const RecruiterApplicant = require("../models/RecruiterApplicant");
const Exam = require("../models/Exam");

async function fixExamStatusInDb() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/veriproof");
  console.log("Connected to MongoDB.");

  const applicants = await RecruiterApplicant.find({});
  console.log(`Found ${applicants.length} total RecruiterApplicant records.`);

  let updatedCount = 0;
  for (const app of applicants) {
    if (app.candidateUser) {
      const exam = await Exam.findOne({ candidateId: app.candidateUser }).sort({ createdAt: -1 });
      if (exam && (exam.status === "Completed" || exam.score > 0)) {
        app.examStatus = "Attended";
        app.examScore = exam.score;
      } else if (exam && ["In Progress", "in_progress", "Started"].includes(exam.status)) {
        app.examStatus = "In Progress";
        app.examScore = null;
      } else {
        app.examStatus = "Not Attended";
        app.examScore = null;
      }
    } else {
      app.examStatus = app.emailStatus === "sent" ? "Not Attended" : "Unregistered";
      app.examScore = null;
    }
    await app.save();
    updatedCount++;
  }

  console.log(`✓ Successfully updated ${updatedCount} RecruiterApplicant exam states in DB.`);
  await mongoose.disconnect();
}

fixExamStatusInDb().catch(err => {
  console.error("Migration error:", err.message);
  mongoose.disconnect();
  process.exit(1);
});
