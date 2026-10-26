const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseCertificateDocument } = require("../services/parsers/parserRegistry");
const { verifyWithIssuerAdapter, compareNames } = require("../services/adapters/issuerAdapterRegistry");
const { calculateCredentialScore } = require("../services/scoringService");

const FIXTURES = {
  INFOSYS_ML: "D:/New folder/New folder/infosys certi.pdf",
  INFOSYS_BLOCKCHAIN: "D:/New folder/New folder/infosys certiificate.pdf",
  INFOSYS_NEXTGEN: "D:/New folder/New folder/infosys.pdf",
  NPTEL_C: "D:/New folder/New folder/Introduction to Programming in C.pdf",
};

const ACCOUNT_USER = {
  name: "SHRIDHAR SHARATKUMAR HEGDE",
  email: "shridhar@example.com",
};

async function runTests() {
  console.log("=== RUNNING VERIPROOF CERTIFICATE PIPELINE TEST SUITE ===\n");
  let passed = 0;
  let total = 0;

  function test(desc, fn) {
    total++;
    try {
      fn();
      console.log(`  [PASS] ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${desc}\n         ${err.message}`);
      throw err;
    }
  }

  // 1. Fixture A: Infosys Machine Learning
  console.log("Testing Fixture A: Infosys Springboard - Explore Machine Learning using Python...");
  const bufA = fs.readFileSync(FIXTURES.INFOSYS_ML);
  const dataA = await parseCertificateDocument(bufA, "application/pdf", "infosys certi.pdf");

  test("Fixture A: Recipient as printed", () => {
    assert.strictEqual(dataA.recipient_as_printed, "SHRIDHAR SHARATKUMAR HEGDE");
  });
  test("Fixture A: Title as printed", () => {
    assert.strictEqual(dataA.title_as_printed, "Explore Machine Learning using Python");
  });
  test("Fixture A: Issuer as printed & canonical", () => {
    assert.strictEqual(dataA.issuer_as_printed, "Infosys Limited, Infosys Springboard");
    assert.strictEqual(dataA.issuer_canonical, "Infosys Springboard");
  });
  test("Fixture A: Certificate Type", () => {
    assert.strictEqual(dataA.certificate_type, "Course Completion Certificate");
  });
  test("Fixture A: Issue Date", () => {
    assert.strictEqual(dataA.issue_date, "2026-03-07");
  });
  test("Fixture A: Signatory", () => {
    assert.strictEqual(
      dataA.signatory,
      "Satheesha B. Nanjappa, Senior Vice President and Head, Education, Training and Assessment, Infosys Limited"
    );
  });
  test("Fixture A: Verification URL", () => {
    assert.strictEqual(dataA.verification_url, "https://verify.onwingspan.com");
  });

  // 2. Fixture B: Infosys Blockchain
  console.log("\nTesting Fixture B: Infosys Springboard - Blockchain...");
  const bufB = fs.readFileSync(FIXTURES.INFOSYS_BLOCKCHAIN);
  const dataB = await parseCertificateDocument(bufB, "application/pdf", "infosys certiificate.pdf");

  test("Fixture B: Title is Blockchain", () => {
    assert.strictEqual(dataB.title_as_printed, "Blockchain");
  });
  test("Fixture B: Program Completion Certificate", () => {
    assert.strictEqual(dataB.certificate_type, "Program Completion Certificate");
  });
  test("Fixture B: Issue date 2026-03-07", () => {
    assert.strictEqual(dataB.issue_date, "2026-03-07");
  });

  // 3. Fixture C: Infosys Next Gen Technologies
  console.log("\nTesting Fixture C: Infosys Springboard - Next Gen Technologies...");
  const bufC = fs.readFileSync(FIXTURES.INFOSYS_NEXTGEN);
  const dataC = await parseCertificateDocument(bufC, "application/pdf", "infosys.pdf");

  test("Fixture C: Title is Next Gen Technologies", () => {
    assert.strictEqual(dataC.title_as_printed, "Next Gen Technologies");
  });
  test("Fixture C: Course Completion Certificate", () => {
    assert.strictEqual(dataC.certificate_type, "Course Completion Certificate");
  });
  test("Titles are distinct and not swapped or generic", () => {
    assert.notStrictEqual(dataA.title_as_printed, dataB.title_as_printed);
    assert.notStrictEqual(dataB.title_as_printed, dataC.title_as_printed);
    assert(!dataA.title_as_printed.includes("Cloud Computing & Full Stack"));
  });

  // 4. Fixture D: NPTEL Introduction to Programming in C
  console.log("\nTesting Fixture D: NPTEL - Introduction to Programming in C...");
  const bufD = fs.readFileSync(FIXTURES.NPTEL_C);
  const dataD = await parseCertificateDocument(bufD, "application/pdf", "Introduction to Programming in C.pdf");

  test("Fixture D: Issuer as printed & canonical", () => {
    assert.strictEqual(
      dataD.issuer_as_printed,
      "NPTEL, Indian Institute of Technology Kanpur (Funded by MoE, Govt. of India)"
    );
    assert.strictEqual(dataD.issuer_canonical, "NPTEL");
  });
  test("Fixture D: Recipient as printed", () => {
    assert.strictEqual(dataD.recipient_as_printed, "SHRIDHAR SHARATKUMAR HEGDE");
  });
  test("Fixture D: Roll number / Credential ID", () => {
    assert.strictEqual(dataD.credential_id, "NPTEL25CS119S541500128");
  });
  test("Fixture D: Session or period", () => {
    assert.strictEqual(dataD.session_or_period, "Jul-Sep 2025, 8 week course");
  });
  test("Fixture D: Consolidated score 73%", () => {
    assert.strictEqual(dataD.score_details?.consolidated_score, "73%");
  });
  test("Fixture D: Online assignments 25/25", () => {
    assert.strictEqual(dataD.score_details?.online_assignments, "25/25");
  });
  test("Fixture D: Proctored exam 47.87/75", () => {
    assert.strictEqual(dataD.score_details?.proctored_exam, "47.87/75");
  });
  test("Fixture D: Candidates certified 1771", () => {
    assert.strictEqual(dataD.score_details?.candidates_certified, 1771);
  });
  test("Fixture D: Credits recommended 2 or 3", () => {
    assert.strictEqual(dataD.score_details?.credits_recommended, "2 or 3");
  });
  test("Fixture D: Elite badge earned", () => {
    assert.strictEqual(dataD.score_details?.elite_badge, true);
  });

  // 5. Verification States & Name Mismatch Logic
  console.log("\nTesting Verification States & Security Adapters...");

  // Match recipient with account
  const verifyStateA = await verifyWithIssuerAdapter(dataA, ACCOUNT_USER);
  test("Infosys Springboard sets DOCUMENT_READ without fake confirmed", () => {
    assert.strictEqual(verifyStateA.status, "DOCUMENT_READ");
  });

  // Name Mismatch
  const mismatchUser = { name: "Rahul Sharma", email: "rahul@example.com" };
  const verifyMismatch = await verifyWithIssuerAdapter(dataA, mismatchUser);
  test("Different recipient name ends in NAME_MISMATCH", () => {
    assert.strictEqual(verifyMismatch.status, "NAME_MISMATCH");
  });

  // Scoring with Name Mismatch
  const scoreMismatch = calculateCredentialScore({ verificationStatus: verifyMismatch.status });
  test("NAME_MISMATCH awards exactly 0 XP", () => {
    assert.strictEqual(scoreMismatch.xpEarned, 0);
  });

  // Scoring with Proctored Exam vs Completion
  const scoreNptel = calculateCredentialScore({
    verificationStatus: "ISSUER_CONFIRMED",
    score_details: dataD.score_details,
  });
  test("Confirmed proctored exam earns full 300 XP", () => {
    assert.strictEqual(scoreNptel.xpEarned, 300);
  });

  const scoreDocRead = calculateCredentialScore({
    verificationStatus: "DOCUMENT_READ",
    score_details: null,
  });
  test("DOCUMENT_READ earns reduced 25% weight (25 XP)", () => {
    assert.strictEqual(scoreDocRead.xpEarned, 25);
  });

  console.log(`\n========================================`);
  console.log(`ALL ${passed}/${total} ASSERTIONS PASSED WITH 0 FAILURES!`);
  console.log(`========================================\n`);
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error("\nTEST SUITE FAILED:", err);
    process.exit(1);
  });
}

module.exports = { runTests };
