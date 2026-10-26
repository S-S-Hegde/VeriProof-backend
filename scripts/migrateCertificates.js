/**
 * Migration Script: Migrate & Audit Existing Certificate Records
 *
 * Requirements:
 * - Prints which database .env points to (without logging .env contents)
 * - Writes backup JSON export of existing certificates
 * - Supports --dry-run mode showing diff before making updates
 * - Reports records with missing files
 */
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const Certificate = require("../models/Certificate");
const User = require("../models/User");
const { recalculateUserCertificateScore } = require("../services/scoringService");

async function runMigration({ isDryRun = true } = {}) {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/skillproof";
  await mongoose.connect(uri);

  const dbName = mongoose.connection.name;
  console.log(`\n==================================================`);
  console.log(`[MIGRATION] Database Target: "${dbName}" (Dry Run: ${isDryRun ? "YES" : "NO"})`);
  console.log(`==================================================\n`);

  const certificates = await Certificate.find({}).lean();
  console.log(`Found ${certificates.length} existing certificate records.`);

  // Write backup outside the repository
  const backupDir = path.join(__dirname, "../../../scratch");
  const fallbackBackupDir = path.join(__dirname, "../backups");
  const targetDir = fs.existsSync(backupDir) ? backupDir : fallbackBackupDir;
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

  const backupFilePath = path.join(targetDir, `certificates_backup_${Date.now()}.json`);
  fs.writeFileSync(backupFilePath, JSON.stringify(certificates, null, 2));
  console.log(`[Backup] Exported ${certificates.length} records to: ${backupFilePath}`);

  const missingFiles = [];
  const plannedUpdates = [];

  for (const cert of certificates) {
    let hasFile = Boolean(cert.gridfs_id || cert.fileBufferBase64);
    if (!hasFile && cert.fileUrl) {
      const localBasename = path.basename(cert.fileUrl.split("?")[0]);
      const diskPath = path.join(__dirname, "../uploads/certificates", localBasename);
      if (fs.existsSync(diskPath)) {
        hasFile = true;
      }
    }

    if (!hasFile) {
      missingFiles.push({
        id: cert._id,
        title: cert.title,
        issuer: cert.issuer,
        createdAt: cert.createdAt,
      });
    }

    // Check if status needs migration from legacy "Verified"
    if (cert.verificationStatus === "Verified" || !cert.verificationStatus) {
      plannedUpdates.push({
        id: cert._id,
        title: cert.title,
        currentStatus: cert.verificationStatus || "unspecified",
        newStatus: "DOCUMENT_READ",
        reason: "Migrated from legacy unverified status to DOCUMENT_READ.",
      });
    }
  }

  console.log(`\n[Missing Files Audit] Records with missing files: ${missingFiles.length}`);
  if (missingFiles.length > 0) {
    console.table(missingFiles);
  } else {
    console.log("No existing records have missing files.");
  }

  console.log(`\n[Planned Schema Updates] Records to migrate: ${plannedUpdates.length}`);
  if (plannedUpdates.length > 0) {
    console.table(plannedUpdates);
  }

  if (isDryRun) {
    console.log("\n[DRY RUN COMPLETE] No records were modified. Pass --execute to apply changes.\n");
  } else {
    console.log("\n[EXECUTING UPDATES] Applying changes to database...");
    for (const update of plannedUpdates) {
      await Certificate.updateOne(
        { _id: update.id },
        {
          $set: {
            verificationStatus: update.newStatus,
            verificationReason: update.reason,
          },
        }
      );
    }

    // Recalculate scores
    const userIds = Array.from(new Set(certificates.map((c) => String(c.user))));
    console.log(`Recalculating scores for ${userIds.length} users...`);
    for (const uid of userIds) {
      await recalculateUserCertificateScore(uid, Certificate, User);
    }
    console.log("[EXECUTION COMPLETE] All records migrated successfully.\n");
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  const isDryRun = !process.argv.includes("--execute");
  runMigration({ isDryRun }).catch((err) => {
    console.error("[Migration Error]:", err.message);
    process.exit(1);
  });
}

module.exports = { runMigration };
