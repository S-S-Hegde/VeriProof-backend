/**
 * sendEmail.js
 *
 * Universal Automated Email Dispatcher.
 * Operates over HTTPS REST APIs (Port 443) to bypass cloud container SMTP port blocks.
 * Supports:
 *   1. Brevo REST API (100% Free, No Domain Needed, Unblockable on Render)
 *   2. Resend REST API (HTTPS Port 443)
 *   3. Nodemailer SMTP (Localhost fallback)
 */

const axios = require("axios");
const nodemailer = require("nodemailer");

// Collect all configured Brevo Accounts (API Keys & corresponding Verified Senders)
const getBrevoAccounts = () => {
  const accounts = [];

  // Account 1
  const key1 = (process.env.BREVO_API_KEY || (process.env.SMTP_PASS?.startsWith("xkeysib-") ? process.env.SMTP_PASS : "") || "").trim();
  const sender1 = (process.env.FROM_EMAIL || "veriproof.platform@gmail.com").trim();
  if (key1) accounts.push({ key: key1, sender: sender1, id: "Brevo-Account-1" });

  // Account 2
  const key2 = (process.env.BREVO_API_KEY_2 || "").trim();
  const sender2 = (process.env.FROM_EMAIL_2 || sender1).trim();
  if (key2) accounts.push({ key: key2, sender: sender2, id: "Brevo-Account-2" });

  // Account 3
  const key3 = (process.env.BREVO_API_KEY_3 || "").trim();
  const sender3 = (process.env.FROM_EMAIL_3 || sender1).trim();
  if (key3) accounts.push({ key: key3, sender: sender3, id: "Brevo-Account-3" });

  // Account 4
  const key4 = (process.env.BREVO_API_KEY_4 || "").trim();
  const sender4 = (process.env.FROM_EMAIL_4 || sender1).trim();
  if (key4) accounts.push({ key: key4, sender: sender4, id: "Brevo-Account-4" });

  // Account 5
  const key5 = (process.env.BREVO_API_KEY_5 || "").trim();
  const sender5 = (process.env.FROM_EMAIL_5 || sender1).trim();
  if (key5) accounts.push({ key: key5, sender: sender5, id: "Brevo-Account-5" });

  return accounts;
};

const getResendKey = () => (process.env.RESEND_API_KEY || "").trim();

const hasRealSMTP = () =>
  !!(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());

// ── Provider 1: Multi-Account Brevo HTTPS REST API (Port 443 — 100% Free & Open) ───
const sendViaBrevoHTTP = async (options, account) => {
  const senderName = (process.env.FROM_NAME || "VeriProof Platform").trim();

  const textContent = (
    options.message ||
    options.text ||
    (options.html ? options.html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim() : "") ||
    "VeriProof Verification Code"
  );

  const payload = {
    sender: { name: senderName, email: account.sender },
    to: [{ email: options.email }],
    subject: options.subject,
    htmlContent: options.html || `<p>${options.message || options.text || ""}</p>`,
    textContent: textContent,
  };

  const { data } = await axios.post("https://api.brevo.com/v3/smtp/email", payload, {
    headers: {
      "api-key": account.key,
      "Content-Type": "application/json",
    },
    timeout: 8000,
  });

  console.log(`✅ [Email/${account.id} HTTP] Delivered → ${options.email} (messageId: ${data.messageId})`);
  return data;
};

// ── Provider 2: Resend HTTPS REST API (Port 443) ────────────────────────
const sendViaResendHTTP = async (options) => {
  const apiKey = getResendKey();
  let fromEmail = (process.env.FROM_EMAIL || "").trim();
  if (!fromEmail || fromEmail.endsWith("@gmail.com")) {
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
    timeout: 8000,
  });

  console.log(`✅ [Email/Resend HTTP] Delivered → ${options.email} (id: ${data.id})`);
  return data;
};

// ── Provider 3: Nodemailer SMTP Transport (Localhost fallback) ──────────
const createSMTPTransport = () => {
  const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const user = (process.env.SMTP_USER || "veriproof.platform@gmail.com").trim();
  const pass = (process.env.SMTP_PASS || "").trim().replace(/\s+/g, "");

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
};

let currentBrevoIndex = 0;

const sendEmail = async (options) => {
  // Try 1: Brevo Multi-Account Pool (Port 443 - Round-Robin Load Balanced + Auto-Failover)
  const brevoAccounts = getBrevoAccounts();
  if (brevoAccounts.length > 0) {
    for (let i = 0; i < brevoAccounts.length; i++) {
      const targetAccount = brevoAccounts[(currentBrevoIndex + i) % brevoAccounts.length];
      try {
        const result = await sendViaBrevoHTTP(options, targetAccount);
        // Advance round-robin pointer for next dispatch
        currentBrevoIndex = (currentBrevoIndex + 1) % brevoAccounts.length;
        return result;
      } catch (brevoErr) {
        console.warn(
          `[Email/${targetAccount.id}] API warning (${brevoErr.response?.data?.message || brevoErr.message}) — failing over to next Brevo account`
        );
      }
    }
  }

  // Try 2: Resend HTTP API (Port 443)
  if (getResendKey()) {
    try {
      return await sendViaResendHTTP(options);
    } catch (resendErr) {
      console.warn(`[Email/Resend HTTP] API error (${resendErr.response?.data?.message || resendErr.message}) — trying fallback`);
    }
  }

  // Try 3: Direct SMTP (Localhost / open port environments)
  if (hasRealSMTP()) {
    const transporter = createSMTPTransport();
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
      console.log(`✅ [Email/SMTP] Delivered → ${options.email} (messageId: ${info.messageId})`);
      return info;
    } catch (smtpErr) {
      console.error(`❌ [Email/SMTP Error] Failed → ${options.email}:`, smtpErr.message);
      throw smtpErr;
    }
  }

  console.warn(`⚠️ [Email Warning] No working email credentials configured.`);
};

module.exports = sendEmail;
