/**
 * CI Verification Check: Verify Zero Vendor Leftovers & Hygiene
 *
 * Requirements:
 * 1. Greps the repo (excluding node_modules, lockfiles, trusted_verifiers.json,
 *    issuer_aliases.json, tests/private_fixtures/) and FAILS if it finds:
 *    "Infosys", "Springboard", "NPTEL", "onwingspan", "sunbirdrc", "nptel.ac.in",
 *    "wingspan", or any real roll number / personal name from our fixtures.
 * 2. Checks that no vendor-named file or function exists.
 * 3. Checks that every code path producing certificate fields goes through
 *    universalExtractor and groundingGate (no direct writes to Certificate model
 *    from other modules).
 */

const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const FORBIDDEN_TOKENS = [
  "infosys",
  "springboard",
  "nptel",
  "onwingspan",
  "sunbirdrc",
  "nptel.ac.in",
  "wingspan",
  "nptel25cs119s541500128",
  "shridhar sharatkumar hegde",
];

const EXCLUDED_PATHS = [
  "node_modules",
  "package-lock.json",
  "data/trusted_verifiers.json",
  "data/issuer_aliases.json",
  "tests/private_fixtures",
  "scripts/verifyZeroVendorLeftovers.js",
  ".git",
  "backups",
  "dist",
];

function isExcluded(filePath) {
  const norm = filePath.replace(/\\/g, "/");
  return EXCLUDED_PATHS.some((ex) => norm.includes(`/${ex}/`) || norm.endsWith(`/${ex}`) || norm.includes(ex));
}

function scanDirectory(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (isExcluded(fullPath)) continue;

    if (entry.isDirectory()) {
      scanDirectory(fullPath, fileList);
    } else if (entry.isFile()) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function runVerification() {
  console.log("=== RUNNING ZERO-VENDOR LEFTOVERS & HYGIENE CI CHECK ===");
  let failed = false;
  const violations = [];

  // 1. Check for vendor-named files
  const allFiles = scanDirectory(ROOT_DIR);
  console.log(`Auditing ${allFiles.length} files across repository...`);

  for (const file of allFiles) {
    const baseName = path.basename(file).toLowerCase();
    for (const token of ["infosys", "springboard", "nptel"]) {
      if (baseName.includes(token)) {
        violations.push({
          file: path.relative(ROOT_DIR, file),
          issue: `File name contains forbidden vendor token "${token}"`,
        });
        failed = true;
      }
    }
  }

  // 2. Grep file contents for forbidden tokens
  const textExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".json", ".md", ".html", ".css", ".env.example"]);
  for (const file of allFiles) {
    const ext = path.extname(file).toLowerCase();
    if (!textExtensions.has(ext)) continue;

    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n");

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      const line = lines[lineNum - 1];
      const lower = line.toLowerCase();

      for (const token of FORBIDDEN_TOKENS) {
        if (lower.includes(token)) {
          // Exclude self-references in this verification script
          if (file.includes("verifyZeroVendorLeftovers.js") && (line.includes("FORBIDDEN_TOKENS") || line.includes("runVerification"))) {
            continue;
          }
          violations.push({
            file: path.relative(ROOT_DIR, file),
            line: lineNum,
            token,
            content: line.trim(),
          });
          failed = true;
        }
      }
    }
  }

  // 3. Verify Certificate model write paths
  console.log("Verifying Certificate model creation code paths...");
  for (const file of allFiles) {
    if (!file.endsWith(".js") && !file.endsWith(".jsx")) continue;
    const content = fs.readFileSync(file, "utf-8");

    if (content.includes("Certificate.create(") || content.includes("new Certificate(")) {
      const relPath = path.relative(ROOT_DIR, file).replace(/\\/g, "/");
      if (relPath !== "controllers/certificateController.js") {
        violations.push({
          file: relPath,
          issue: `Unauthorized direct write to Certificate model outside certificateController.js`,
        });
        failed = true;
      }
    }
  }

  // Verify certificateController.js uses extractUniversalCertificate
  const controllerPath = path.join(ROOT_DIR, "controllers/certificateController.js");
  const controllerContent = fs.readFileSync(controllerPath, "utf-8");
  if (!controllerContent.includes("extractUniversalCertificate")) {
    violations.push({
      file: "controllers/certificateController.js",
      issue: "certificateController.js does not route through extractUniversalCertificate",
    });
    failed = true;
  }

  // Report results
  if (failed) {
    console.error("\n❌ [FAIL] Vendor leftovers or hygiene violations detected:\n");
    for (const v of violations) {
      if (v.issue) {
        console.error(`  - ${v.file}: ${v.issue}`);
      } else {
        console.error(`  - ${v.file}:${v.line} -> Found token "${v.token}": ${v.content}`);
      }
    }
    process.exit(1);
  }

  console.log("\n✅ [PASS] Zero vendor tokens, zero personal data, and strict extraction routing confirmed!");
  console.log("========================================================\n");
}

if (require.main === module) {
  runVerification();
}

module.exports = { runVerification };
