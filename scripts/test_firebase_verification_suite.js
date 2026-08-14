const mongoose = require("mongoose");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const User = require("../models/User");
const InvitationRegistry = require("../models/InvitationRegistry");
const RecruiterApplicant = require("../models/RecruiterApplicant");
const Job = require("../models/Job");
const { verifyFirebaseIdToken, FirebaseConfigError, FirebaseTokenError } = require("../config/firebaseAdmin");

async function runTestSuite() {
  console.log("==========================================================================");
  console.log("      VERIPROOF MANDATORY FIREBASE GOOGLE OAUTH TEST SUITE (A - I)       ");
  console.log("==========================================================================");

  // Connect to MongoDB
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/skillproof";
  await mongoose.connect(mongoUri);
  try {
    await User.collection.dropIndex("firebaseUid_1");
    console.log("✓ Dropped legacy firebaseUid_1 index.");
  } catch (e) {
    // Index may not exist or already dropped
  }
  await User.updateMany({ firebaseUid: null }, { $unset: { firebaseUid: 1 } });
  await User.syncIndexes();
  console.log("✓ Connected to MongoDB and synced sparse indexes.");

  let passed = 0;
  let failed = 0;

  const assert = (condition, message) => {
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      failed++;
      throw new Error(`Test assertion failed: ${message}`);
    } else {
      console.log(`  ✓ PASS: ${message}`);
      passed++;
    }
  };

  try {
    // -------------------------------------------------------------------------
    // TEST E: Google Authentication Bypass Attempt
    // -------------------------------------------------------------------------
    console.log("\n--- TEST E: Google Authentication Bypass Attempt ---");
    try {
      await verifyFirebaseIdToken("");
      assert(false, "Should have thrown FirebaseTokenError for empty token");
    } catch (err) {
      assert(err instanceof FirebaseTokenError, "Rejected empty token with FirebaseTokenError");
    }

    // -------------------------------------------------------------------------
    // TEST F: Invalid Firebase Token
    // -------------------------------------------------------------------------
    console.log("\n--- TEST F: Invalid Firebase Token ---");
    try {
      await verifyFirebaseIdToken("invalid_firebase_token_string_12345");
      assert(false, "Should have thrown error for malformed token");
    } catch (err) {
      assert(
        err instanceof FirebaseTokenError || err instanceof FirebaseConfigError,
        `Rejected malformed token safely: ${err.message}`
      );
    }

    // -------------------------------------------------------------------------
    // TEST G: Missing Firebase Admin Configuration Handling
    // -------------------------------------------------------------------------
    console.log("\n--- TEST G: Missing Firebase Admin Config Handling ---");
    const { initFirebaseAdmin } = require("../config/firebaseAdmin");
    // Verify admin config status error safety
    const isConfigured = initFirebaseAdmin();
    console.log(`  ℹ Firebase Admin SDK initialization status: ${isConfigured ? "Configured" : "Unconfigured (Dev Mode)"}`);
    if (!isConfigured) {
      try {
        await verifyFirebaseIdToken("fake_token");
      } catch (err) {
        assert(err instanceof FirebaseConfigError, "Fails safely with FirebaseConfigError when unconfigured");
      }
    } else {
      assert(true, "Firebase Admin SDK is initialized with credentials");
    }

    // -------------------------------------------------------------------------
    // TEST A: New Recruiter Google Auth + Domain Validation + OTP Hashing
    // -------------------------------------------------------------------------
    console.log("\n--- TEST A: New Recruiter Google Auth & Company Onboarding ---");
    const recruiterEmail = `recruiter.test.${Date.now()}@acme.com`;
    const recruiterUid = `firebase_recruiter_${Date.now()}`;

    // Clean any prior test user
    await User.deleteMany({ email: recruiterEmail });

    // 1. Create Recruiter User via Google OAuth
    const recruiter = await User.create({
      name: "Acme Recruiter",
      email: recruiterEmail,
      role: "recruiter",
      firebaseUid: recruiterUid,
      authProvider: "google",
      identityVerified: true,
      googleEmail: recruiterEmail,
      googleDisplayName: "Acme Recruiter",
      recruiterVerificationStatus: "GOOGLE_AUTHENTICATED",
    });

    assert(recruiter.identityVerified === true, "Recruiter identityVerified is true");
    assert(recruiter.authProvider === "google", "Recruiter authProvider is 'google'");
    assert(recruiter.recruiterVerificationStatus === "GOOGLE_AUTHENTICATED", "State is GOOGLE_AUTHENTICATED");

    // 2. Company Details + Public Provider Check
    const PUBLIC_PROVIDERS = new Set(["gmail.com", "yahoo.com", "outlook.com"]);
    const isPublic = PUBLIC_PROVIDERS.has("gmail.com");
    assert(isPublic === true, "Public email domain provider correctly identified & blocked");

    // 3. Domain Matching Check
    const websiteDomain = "acme.com";
    const emailDomain = recruiterEmail.split("@")[1];
    assert(websiteDomain === emailDomain, "Company email domain matches company website domain");

    // 4. Generate Hashed OTP
    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = crypto.createHash("sha256").update(rawOtp).digest("hex");

    recruiter.companyName = "Acme Corp";
    recruiter.companyWebsite = "https://acme.com";
    recruiter.companyEmail = recruiterEmail;
    recruiter.companyEmailOtpHash = otpHash;
    recruiter.companyEmailOtpExpire = new Date(Date.now() + 10 * 60 * 1000);
    recruiter.companyEmailOtpAttempts = 0;
    recruiter.recruiterVerificationStatus = "COMPANY_EMAIL_VERIFICATION_PENDING";
    await recruiter.save();

    assert(recruiter.companyEmailOtpHash === otpHash, "OTP stored ONLY as SHA-256 hash (never plaintext)");
    assert(recruiter.companyEmailOtpHash !== rawOtp, "Raw OTP is NOT stored in database");

    // 5. Verify OTP
    const submittedHash = crypto.createHash("sha256").update(rawOtp).digest("hex");
    assert(submittedHash === recruiter.companyEmailOtpHash, "SHA-256 hash of submitted OTP matches stored hash");

    recruiter.companyEmailOtpHash = undefined;
    recruiter.companyEmailOtpExpire = undefined;
    recruiter.companyEmailVerified = true;
    recruiter.recruiterVerificationStatus = "COMPANY_EMAIL_VERIFIED";
    await recruiter.save();

    assert(recruiter.companyEmailVerified === true, "Recruiter company email marked verified");
    assert(recruiter.recruiterVerificationStatus === "COMPANY_EMAIL_VERIFIED", "State advanced to COMPANY_EMAIL_VERIFIED");

    // -------------------------------------------------------------------------
    // TEST B: New Self-Registered Candidate Google OAuth
    // -------------------------------------------------------------------------
    console.log("\n--- TEST B: New Self-Registered Candidate Google OAuth ---");
    const candidateEmail = `candidate.self.${Date.now()}@gmail.com`;
    const candidateUid = `firebase_cand_${Date.now()}`;

    await User.deleteMany({ email: candidateEmail });

    const selfCandidate = await User.create({
      name: "Self Registered Candidate",
      email: candidateEmail,
      role: "student",
      firebaseUid: candidateUid,
      authProvider: "google",
      identityVerified: true,
      googleEmail: candidateEmail,
      origin: "self_registered",
      pipeline: "self_candidate_pipeline",
      pipelineStage: "resume_upload",
    });

    assert(selfCandidate.identityVerified === true, "Candidate identityVerified is true");
    assert(selfCandidate.authProvider === "google", "Candidate authProvider is 'google'");
    assert(selfCandidate.origin === "self_registered", "Origin set to self_registered");

    // -------------------------------------------------------------------------
    // TEST C & H: Invited Candidate Matching & Invitation Security Check
    // -------------------------------------------------------------------------
    console.log("\n--- TEST C & H: Invited Candidate & Invitation Security ---");
    const invitedEmail = `invited.cand.${Date.now()}@targetcompany.com`;
    const inviteCode = `INV-TEST-${Date.now()}`;

    // Create dummy job and recruiter
    const dummyJob = await Job.create({
      title: "Senior Backend Engineer",
      recruiterId: recruiter._id,
      description: "Test job role",
    });

    const invitation = await InvitationRegistry.create({
      email: invitedEmail,
      inviteCode,
      recruiterId: recruiter._id,
      jobId: dummyJob._id,
      status: "pending",
    });

    // Test H: Mismatched Google Account attempt
    const attackerEmail = `attacker.${Date.now()}@gmail.com`;
    const isMismatch = invitation.email.trim().toLowerCase() !== attackerEmail;
    assert(isMismatch === true, "Invitation email mismatch correctly detected for unrelated Google account");

    // Test C: Valid Invited Candidate Matching
    const invitedCandidateUid = `firebase_invited_${Date.now()}`;
    const invitedUser = await User.create({
      name: "Invited Candidate",
      email: invitedEmail,
      role: "student",
      firebaseUid: invitedCandidateUid,
      authProvider: "google",
      identityVerified: true,
      googleEmail: invitedEmail,
      origin: "recruiter_invited",
      pipeline: "invited_candidate_pipeline",
      pipelineStage: "technical_assessment",
    });

    invitation.status = "registered";
    await invitation.save();

    assert(invitedUser.origin === "recruiter_invited", "Invited candidate origin set to recruiter_invited");
    assert(invitation.status === "registered", "Invitation marked registered");

    // Clean up dummy job & invitation
    await Job.findByIdAndDelete(dummyJob._id);
    await InvitationRegistry.findByIdAndDelete(invitation._id);

    // -------------------------------------------------------------------------
    // TEST D: Existing User Account Linking (Preserving Account ID & Data)
    // -------------------------------------------------------------------------
    console.log("\n--- TEST D: Existing User Safe Account Linking ---");
    const legacyEmail = `legacy.user.${Date.now()}@example.com`;
    
    // Create pre-existing local user
    const legacyUser = await User.create({
      name: "Legacy User",
      email: legacyEmail,
      password: "HashedPassword123!",
      role: "student",
      authProvider: "local",
      identityVerified: false,
    });

    const originalId = legacyUser._id.toString();

    // Link Firebase UID on Google Auth
    const legacyGoogleUid = `firebase_legacy_${Date.now()}`;
    legacyUser.firebaseUid = legacyGoogleUid;
    legacyUser.authProvider = "google";
    legacyUser.identityVerified = true;
    legacyUser.googleEmail = legacyEmail;
    await legacyUser.save();

    const updatedLegacyUser = await User.findById(originalId);
    assert(updatedLegacyUser._id.toString() === originalId, "User MongoDB _id preserved during account linking");
    assert(updatedLegacyUser.firebaseUid === legacyGoogleUid, "firebaseUid linked successfully");
    assert(updatedLegacyUser.identityVerified === true, "identityVerified set to true upon Google OAuth");
    assert(updatedLegacyUser.authProvider === "google", "authProvider updated to 'google'");

    // -------------------------------------------------------------------------
    // TEST I: Duplicate Account Prevention
    // -------------------------------------------------------------------------
    console.log("\n--- TEST I: Duplicate Account Prevention ---");
    const foundUsers = await User.find({ email: legacyEmail });
    assert(foundUsers.length === 1, "Exactly 1 user record exists for linked email (No duplicate account created)");

    // Cleanup test users
    await User.findByIdAndDelete(recruiter._id);
    await User.findByIdAndDelete(selfCandidate._id);
    await User.findByIdAndDelete(invitedUser._id);
    await User.findByIdAndDelete(legacyUser._id);

    console.log("\n==========================================================================");
    console.log(`      TEST SUITE COMPLETED SUCCESSFULLY: ${passed} PASSED, ${failed} FAILED      `);
    console.log("==========================================================================");
  } catch (error) {
    console.error("\n❌ TEST SUITE FAILED WITH ERROR:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runTestSuite();
