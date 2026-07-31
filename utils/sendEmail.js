/**
 * sendEmail.js
 *
 * Email delivery via real Gmail SMTP (production) or Ethereal (dev preview).
 *
 * To enable REAL delivery, fill these 3 fields in backend/.env:
 *   SMTP_USER=youraddress@gmail.com
 *   SMTP_PASS=xxxx xxxx xxxx xxxx   (Gmail App Password — 16 chars)
 *   FROM_EMAIL=youraddress@gmail.com
 *
 * How to create a Gmail App Password:
 *   1. myaccount.google.com → Security → 2-Step Verification → enable
 *   2. Search "App passwords" in the search bar
 *   3. Choose app = "Mail", device = "Other", name it "VeriProof"
 *   4. Copy the 16-character code → paste in SMTP_PASS (no spaces needed)
 */

const nodemailer = require("nodemailer");

const hasRealSMTP = () =>
  !!(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());

const createGmailTransport = () =>
  nodemailer.createTransport({
    host:   process.env.SMTP_HOST || "smtp.gmail.com",
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: false,          // TLS via STARTTLS on port 587
    auth: {
      user: process.env.SMTP_USER.trim(),
      pass: process.env.SMTP_PASS.trim(),
    },
    tls: {
      rejectUnauthorized: false, // avoids self-signed cert errors in dev
    },
  });

const createEtherealTransport = async () => {
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host:   "smtp.ethereal.email",
    port:   587,
    secure: false,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });
};

const sendEmail = async (options) => {
  const usingReal = hasRealSMTP();
  let transporter;

  if (usingReal) {
    transporter = createGmailTransport();
  } else {
    console.warn(
      "\n⚠️  [Email] SMTP_USER / SMTP_PASS not set in .env\n" +
      "   → Using Ethereal (fake inbox). Emails will NOT reach real inboxes.\n" +
      "   → Add Brevo or Gmail App Password to .env to enable real delivery.\n",
    );
    transporter = await createEtherealTransport();
  }

  const message = {
    from: `"${process.env.FROM_NAME || "VeriProof"}" <${
      (process.env.FROM_EMAIL || process.env.SMTP_USER || "noreply@veriproof.dev").trim()
    }>`,
    to:      options.email,
    subject: options.subject,
    html:    options.html    || `<p>${options.message || ""}</p>`,
    text:    options.message || "",
  };

  try {
    const info = await transporter.sendMail(message);

    if (usingReal) {
      console.log(`✅ [Email] Delivered → ${options.email} (messageId: ${info.messageId})`);
    } else {
      console.log("---------------------------------------");
      console.log("DEV MAIL DELIVERED (Ethereal — not real inbox):");
      console.log("To:          ", options.email);
      console.log("Preview URL: ", nodemailer.getTestMessageUrl(info));
      console.log("---------------------------------------");
    }
    return info;
  } catch (err) {
    console.error(`❌ [Email Error] Delivery failed to ${options.email}:`, err.message);
    throw err;
  }
};

module.exports = sendEmail;
