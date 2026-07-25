const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

// Load env variables relative to this scripts directory
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/skillproof";

const wipeData = async () => {
  try {
    console.log(`[Wiper] Connecting to MongoDB: ${mongoUri}`);
    await mongoose.connect(mongoUri);
    console.log("[Wiper] Database connected successfully.");

    // Retrieve database models dynamically
    const User = mongoose.models.User || mongoose.model("User", new mongoose.Schema({}, { strict: false }));
    const Project = mongoose.models.Project || mongoose.model("Project", new mongoose.Schema({}, { strict: false }));
    const ResumeAnalysis = mongoose.models.ResumeAnalysis || mongoose.model("ResumeAnalysis", new mongoose.Schema({}, { strict: false }));
    const VerificationResult = mongoose.models.VerificationResult || mongoose.model("VerificationResult", new mongoose.Schema({}, { strict: false }));
    const Job = mongoose.models.Job || mongoose.model("Job", new mongoose.Schema({}, { strict: false }));

    // Delete all records
    console.log("[Wiper] Purging User documents...");
    const userDeleteResult = await User.deleteMany({});
    console.log(`[Wiper] Wiped ${userDeleteResult.deletedCount} users.`);

    console.log("[Wiper] Purging Project documents...");
    const projectDeleteResult = await Project.deleteMany({});
    console.log(`[Wiper] Wiped ${projectDeleteResult.deletedCount} projects.`);

    console.log("[Wiper] Purging ResumeAnalysis documents...");
    const analysisDeleteResult = await ResumeAnalysis.deleteMany({});
    console.log(`[Wiper] Wiped ${analysisDeleteResult.deletedCount} resume analysis records.`);

    console.log("[Wiper] Purging VerificationResult documents...");
    const resultDeleteResult = await VerificationResult.deleteMany({});
    console.log(`[Wiper] Wiped ${resultDeleteResult.deletedCount} verification results.`);

    console.log("[Wiper] Purging Job documents...");
    const jobDeleteResult = await Job.deleteMany({});
    console.log(`[Wiper] Wiped ${jobDeleteResult.deletedCount} jobs.`);

    // Local files cleanup
    const uploadDirs = [
      path.join(__dirname, "..", "uploads", "profiles"),
      path.join(__dirname, "..", "uploads", "resumes")
    ];

    uploadDirs.forEach((dir) => {
      if (fs.existsSync(dir)) {
        console.log(`[Wiper] Cleaning local uploads in directory: ${dir}`);
        const files = fs.readdirSync(dir);
        files.forEach((file) => {
          const filePath = path.join(dir, file);
          if (fs.statSync(filePath).isFile() && file !== ".gitkeep") {
            try {
              fs.unlinkSync(filePath);
              console.log(`[Wiper] Deleted local file: ${file}`);
            } catch (err) {
              console.error(`[Wiper] Failed to delete file: ${file}`, err);
            }
          }
        });
      }
    });

    console.log("[Wiper] Data wipe complete.");
    process.exit(0);
  } catch (error) {
    console.error("[Wiper] Error purging database directory:", error);
    process.exit(1);
  }
};

wipeData();
