require('dotenv').config();
const sendEmail = require('./utils/sendEmail');

async function testEmail() {
  console.log("Starting email test...");
  console.log("SMTP_HOST:", process.env.SMTP_HOST);
  console.log("SMTP_PORT:", process.env.SMTP_PORT);
  console.log("SMTP_USER:", `"${process.env.SMTP_USER}"`);
  console.log("FROM_EMAIL:", `"${process.env.FROM_EMAIL}"`);
  
  try {
    await sendEmail({
      email: "shridharhhegde@gmail.com",
      subject: "VeriProof Test Email Delivery Verification",
      html: "<h1>Delivery Test</h1><p>Testing Brevo real delivery setup.</p>"
    });
    console.log("✅ Email test function executed without throwing!");
  } catch (err) {
    console.error("❌ Email test threw an error:");
    console.error(err);
  }
}

testEmail();
