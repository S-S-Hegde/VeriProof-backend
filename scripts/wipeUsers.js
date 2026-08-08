const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

// Load env variables relative to this scripts directory
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/veriproof";

const wipeData = async () => {
  try {
    console.log("=========================================================");
    console.log("   VERIPROOF SYSTEM ANNIHILATOR — TOTAL DATA PURGE        ");
    console.log("=========================================================");
    console.log(`[Wiper] Connecting to MongoDB: ${mongoUri}`);
    await mongoose.connect(mongoUri);
    console.log("[Wiper] Database connected successfully.");

    // Define all database models to ensure complete schema purging
    const User = mongoose.models.User || mongoose.model("User", new mongoose.Schema({}, { strict: false }));
    const Project = mongoose.models.Project || mongoose.model("Project", new mongoose.Schema({}, { strict: false }));
    const ResumeAnalysis = mongoose.models.ResumeAnalysis || mongoose.model("ResumeAnalysis", new mongoose.Schema({}, { strict: false }));
    const VerificationResult = mongoose.models.VerificationResult || mongoose.model("VerificationResult", new mongoose.Schema({}, { strict: false }));
    const Job = mongoose.models.Job || mongoose.model("Job", new mongoose.Schema({}, { strict: false }));
    const Exam = mongoose.models.Exam || mongoose.model("Exam", new mongoose.Schema({}, { strict: false }));
    const RecruiterApplicant = mongoose.models.RecruiterApplicant || mongoose.model("RecruiterApplicant", new mongoose.Schema({}, { strict: false }));
    const InvitationRegistry = mongoose.models.InvitationRegistry || mongoose.model("InvitationRegistry", new mongoose.Schema({}, { strict: false }));
    const AIMetrics = mongoose.models.AIMetrics || mongoose.model("AIMetrics", new mongoose.Schema({}, { strict: false }));
    const Question = mongoose.models.Question || mongoose.model("Question", new mongoose.Schema({}, { strict: false }));

    // Delete records from all models
    console.log("\n[Wiper] 💥 Purging all database collections...");
    
    const uCount = await User.deleteMany({});
    console.log(`  ✓ Wiped ${uCount.deletedCount} User documents.`);

    const pCount = await Project.deleteMany({});
    console.log(`  ✓ Wiped ${pCount.deletedCount} Project documents.`);

    const rCount = await ResumeAnalysis.deleteMany({});
    console.log(`  ✓ Wiped ${rCount.deletedCount} ResumeAnalysis documents.`);

    const vCount = await VerificationResult.deleteMany({});
    console.log(`  ✓ Wiped ${vCount.deletedCount} VerificationResult documents.`);

    const jCount = await Job.deleteMany({});
    console.log(`  ✓ Wiped ${jCount.deletedCount} Job documents.`);

    const eCount = await Exam.deleteMany({});
    console.log(`  ✓ Wiped ${eCount.deletedCount} Exam documents.`);

    const aCount = await RecruiterApplicant.deleteMany({});
    console.log(`  ✓ Wiped ${aCount.deletedCount} RecruiterApplicant documents.`);

    const iCount = await InvitationRegistry.deleteMany({});
    console.log(`  ✓ Wiped ${iCount.deletedCount} InvitationRegistry documents.`);

    const mCount = await AIMetrics.deleteMany({});
    console.log(`  ✓ Wiped ${mCount.deletedCount} AIMetrics documents.`);

    const qCount = await Question.deleteMany({});
    console.log(`  ✓ Wiped ${qCount.deletedCount} Question documents.`);

    // Drop all collections in MongoDB to clear any orphaned documents or indexes
    const collections = await mongoose.connection.db.collections();
    for (let collection of collections) {
      try {
        await collection.drop();
        console.log(`  ✓ Dropped collection: ${collection.collectionName}`);
      } catch (dropErr) {
        // Ignore collection not found errors
      }
    }

    // Physical uploaded files cleanup across all upload directories
    console.log("\n[Wiper] 🗑️ Erasing uploaded resumes, profiles, and job artifacts from disk...");
    const uploadsBaseDir = path.join(__dirname, "..", "uploads");

    const cleanDirectoryRecursively = (dirPath) => {
      if (!fs.existsSync(dirPath)) return;
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        if (fs.statSync(fullPath).isDirectory()) {
          cleanDirectoryRecursively(fullPath);
        } else if (item !== ".gitkeep") {
          try {
            fs.unlinkSync(fullPath);
            console.log(`  ✓ Deleted file: ${path.relative(uploadsBaseDir, fullPath)}`);
          } catch (unlinkErr) {
            console.error(`  ❌ Failed to delete ${item}:`, unlinkErr.message);
          }
        }
      }
    };

    cleanDirectoryRecursively(uploadsBaseDir);

    console.log("\n=========================================================");
    console.log("   ✅ TOTAL SYSTEM WIPE COMPLETE!                        ");
    console.log("   All database documents, resumes, and accounts erased. ");
    console.log("=========================================================");
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("[Wiper] Error purging system database:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

wipeData();
