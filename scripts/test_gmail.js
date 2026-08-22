const nodemailer = require("nodemailer");
require("dotenv").config();

async function testMail() {
  console.log("Testing Gmail SMTP with user:", process.env.SMTP_USER);
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
  });

  try {
    const info = await transporter.sendMail({
      from: `"VeriProof Platform" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: "Direct Verification Test",
      text: "Verification email is working directly through Gmail SMTP!",
    });
    console.log("✅ GMAIL SMTP DELIVERED SUCCESSFULLY! Message ID:", info.messageId);
  } catch (err) {
    console.error("❌ GMAIL SMTP FAILED:", err);
  }
}

testMail();
