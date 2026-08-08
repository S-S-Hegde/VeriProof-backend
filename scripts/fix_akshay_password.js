const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const User = require("../models/User");

async function fixCandidatePassword() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/veriproof");

  const targetEmail = "hegdeakshay83@gmail.com";
  const user = await User.findOne({ email: new RegExp(`^${targetEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") });

  if (!user) {
    console.error(`User ${targetEmail} not found in DB!`);
    await mongoose.disconnect();
    return;
  }

  user.password = "YoAwcKdTc50g";
  user.origin = "recruiter_invited";
  user.pipelineStage = "technical_assessment";
  user.otpVerified = false; // Reset 2FA OTP for clean initial login
  await user.save();

  console.log(`=======================================================`);
  console.log(`✓ Password for ${targetEmail} updated to: YoAwcKdTc50g`);
  console.log(`✓ Candidate can now log in directly with YoAwcKdTc50g!`);
  console.log(`=======================================================`);

  await mongoose.disconnect();
}

fixCandidatePassword().catch(err => {
  console.error("Error:", err.message);
  mongoose.disconnect();
  process.exit(1);
});
