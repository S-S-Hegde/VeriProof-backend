const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

// Load env variables relative to this script's directory
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// Collect target MongoDB database URIs to purge (env URI + known default database names)
const configuredUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/skillproof";
const defaultUris = [
  configuredUri,
  "mongodb://127.0.0.1:27017/skillproof",
  "mongodb://127.0.0.1:27017/veriproof",
  "mongodb://localhost:27017/skillproof",
  "mongodb://localhost:27017/veriproof"
];

// Unique database URIs list
const targetUris = Array.from(new Set(defaultUris));

const wipeSingleDatabase = async (uri) => {
  let conn = null;
  try {
    console.log(`\n[Wiper] 🔌 Connecting to MongoDB Target: ${uri}`);
    // Create an isolated connection for this target URI
    conn = await mongoose.createConnection(uri).asPromise();
    const db = conn.db;
    const dbName = db.databaseName;
    console.log(`[Wiper] Connected to database: "${dbName}"`);

    // Fetch all collections directly from MongoDB Native Driver
    const collections = await db.collections();
    console.log(`[Wiper] Found ${collections.length} collection(s) in "${dbName}".`);

    for (const col of collections) {
      const colName = col.collectionName;
      if (colName.startsWith("system.")) continue; // Skip system collections

      try {
        const deleteResult = await col.deleteMany({});
        console.log(`  ✓ Wiped ${deleteResult.deletedCount} document(s) from collection "${colName}".`);
        await col.drop();
        console.log(`  ✓ Dropped collection "${colName}".`);
      } catch (colErr) {
        // Ignore collection drop errors if already empty or gone
      }
    }

    // Drop database atomically to eliminate all indexes, collections, and system tables
    await db.dropDatabase();
    console.log(`  ✓ Atomically dropped database "${dbName}"`);

    await conn.close();
  } catch (err) {
    console.error(`[Wiper] Warning: Failed to purge database at ${uri}:`, err.message);
    if (conn) {
      try { await conn.close(); } catch (_) {}
    }
  }
};

const wipeData = async () => {
  try {
    console.log("=========================================================");
    console.log("   VERIPROOF SYSTEM ANNIHILATOR — TOTAL DATA PURGE        ");
    console.log("=========================================================");

    for (const uri of targetUris) {
      await wipeSingleDatabase(uri);
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
    console.log("   All database documents, exams, and accounts erased. ");
    console.log("=========================================================");
    process.exit(0);
  } catch (error) {
    console.error("[Wiper] Error purging system database:", error);
    process.exit(1);
  }
};

wipeData();


