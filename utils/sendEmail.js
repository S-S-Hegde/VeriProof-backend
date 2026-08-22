/**
 * sendEmail.js
 *
 * Universal Automated Email Dispatcher.
 * Uses Direct Gmail SMTP with App Passwords & Automatic IPv4 Routing.
 */

const nodemailer = require("nodemailer");

const hasRealSMTP = () =>
  !!(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());

const createSMTPTransport = () => {
  const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const user = (process.env.SMTP_USER || "veriproof.platform@gmail.com").trim();
  const pass = (process.env.SMTP_PASS || "").trim().replace(/\s+/g, "");

  // Native Gmail Driver (100% Reliable with App Passwords)
  if (host === "smtp.gmail.com" || user.endsWith("@gmail.com")) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });
  }

  // Brevo Relay
  if (host.includes("brevo.com") || host.includes("sendinblue.com")) {
    return nodemailer.createTransport({
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      family: 4,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });
  }

  // Generic SMTP
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    family: 4,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
};

const createEtherealTransport = async () => {
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
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
    transporter = createSMTPTransport();
  } else {
    console.warn(
      "\n⚠️  [Email] No SMTP credentials set in .env\n" +
      "   → Using Ethereal preview inbox. Emails will NOT reach real inboxes.\n",
    );
    transporter = await createEtherealTransport();
  }

  const senderEmail = (process.env.SMTP_USER || "veriproof.platform@gmail.com").trim();
  const senderName = (process.env.FROM_NAME || "VeriProof Platform").trim();

  const message = {
    from: `"${senderName}" <${senderEmail}>`,
    to: options.email,
    subject: options.subject,
    html: options.html || `<p>${options.message || ""}</p>`,
    text: options.message || options.text || "",
  };

  try {
    const info = await transporter.sendMail(message);

    if (usingReal) {
      console.log(`✅ [Email/SMTP] Delivered → ${options.email} (messageId: ${info.messageId})`);
    } else {
      console.log("---------------------------------------");
      console.log("DEV MAIL DELIVERED (Ethereal Preview):");
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
