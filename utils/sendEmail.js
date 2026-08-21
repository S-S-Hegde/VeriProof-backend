/**
 * sendEmail.js
 *
 * Universal Automated Email Dispatcher.
 * Supports:
 *   1. Resend API (Modern HTTP API — used by Vercel, Linear, Stripe)
 *      Set RESEND_API_KEY in backend/.env (Sign up free at https://resend.com)
 *   2. Nodemailer SMTP (Gmail App Password or Brevo Relay)
 *      Set SMTP_USER and SMTP_PASS in backend/.env
 *   3. Ethereal Dev Preview (Instant 1-click preview URL in console)
 */

const nodemailer = require("nodemailer");
const axios = require("axios");

const hasResendAPI = () => !!process.env.RESEND_API_KEY?.trim();

const hasRealSMTP = () =>
  !!(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());

const sendViaResend = async (options) => {
  const apiKey = process.env.RESEND_API_KEY.trim();
  let fromEmail = (process.env.FROM_EMAIL || "").trim();
  
  // Resend forbids public mailbox domains like @gmail.com — default to onboarding@resend.dev
  if (!fromEmail || fromEmail.endsWith("@gmail.com") || fromEmail.endsWith("@googlemail.com") || fromEmail.endsWith("@yahoo.com") || fromEmail.endsWith("@outlook.com")) {
    fromEmail = "onboarding@resend.dev";
  }
  const fromName = (process.env.FROM_NAME || "VeriProof").trim();

  const payload = {
    from: `${fromName} <${fromEmail}>`,
    to: [options.email],
    subject: options.subject,
    html: options.html || `<p>${options.message || ""}</p>`,
  };

  const { data } = await axios.post("https://api.resend.com/emails", payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  console.log(`✅ [Email/Resend] Delivered → ${options.email} (id: ${data.id})`);
  return data;
};

const createGmailTransport = (port = 465) => {
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim().replace(/\s+/g, "");

  if (port === 465) {
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
      pool: false,
    });
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
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
  // Option 1: Resend API (Preferred for modern web apps)
  if (hasResendAPI()) {
    try {
      return await sendViaResend(options);
    } catch (resendErr) {
      console.warn(`[Email/Resend] API dispatch failed (${resendErr.response?.data?.message || resendErr.message}) — falling back to SMTP`);
    }
  }

  // Option 2: Nodemailer SMTP (Gmail / Brevo)
  const usingReal = hasRealSMTP();
  let transporter;

  if (usingReal) {
    transporter = createGmailTransport();
  } else {
    console.warn(
      "\n⚠️  [Email] No RESEND_API_KEY or SMTP credentials set in .env\n" +
      "   → Using Ethereal preview inbox. Emails will NOT reach real inboxes.\n" +
      "   → Add RESEND_API_KEY or Gmail App Password to .env for real delivery.\n",
    );
    transporter = await createEtherealTransport();
  }

  // When sending via Gmail SMTP, from email MUST match authenticated SMTP_USER to avoid Google rejection
  const senderEmail = usingReal
    ? (process.env.SMTP_USER || "veriproof.platform@gmail.com").trim()
    : (process.env.FROM_EMAIL || "noreply@veriproof.dev").trim();
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
    if (usingReal) {
      console.warn(`[Email/SMTP] Primary port failed (${err.message}), retrying via fallback transport...`);
      try {
        const fallbackTransporter = createGmailTransport(587);
        const fallbackInfo = await fallbackTransporter.sendMail(message);
        console.log(`✅ [Email/SMTP Fallback] Delivered → ${options.email} (messageId: ${fallbackInfo.messageId})`);
        return fallbackInfo;
      } catch (fallbackErr) {
        console.error(`❌ [Email Error] Both SMTP attempts failed to ${options.email}:`, fallbackErr.message);
        throw fallbackErr;
      }
    }
    console.error(`❌ [Email Error] Delivery failed to ${options.email}:`, err.message);
    throw err;
  }
};

module.exports = sendEmail;
