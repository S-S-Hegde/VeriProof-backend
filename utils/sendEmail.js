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

// Check available dispatch providers
const getBrevoKey = () =>
  (process.env.BREVO_API_KEY || (process.env.SMTP_PASS?.startsWith("xkeysib-") ? process.env.SMTP_PASS : "") || "").trim();

const getResendKey = () => (process.env.RESEND_API_KEY || "").trim();

const hasRealSMTP = () =>
  !!(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());

// ── Provider 1: Brevo HTTPS REST API (Port 443 — 100% Open on Render) ───
const sendViaBrevoHTTP = async (options) => {
  const apiKey = getBrevoKey();
  const senderEmail = (process.env.FROM_EMAIL || "veriproof.platform@gmail.com").trim();
  const senderName = (process.env.FROM_NAME || "VeriProof Platform").trim();

  const textContent = (
    options.message ||
    options.text ||
    (options.html ? options.html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim() : "") ||
    "VeriProof Verification Code"
  );

  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: options.email }],
    subject: options.subject,
    htmlContent: options.html || `<p>${options.message || options.text || ""}</p>`,
    textContent: textContent,
  };

  const { data } = await axios.post("https://api.brevo.com/v3/smtp/email", payload, {
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    timeout: 8000,
  });

  console.log(`✅ [Email/Brevo HTTP] Delivered → ${options.email} (messageId: ${data.messageId})`);
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

const sendEmail = async (options) => {
  // Try 1: Brevo HTTP API (Port 443 - Bypasses all cloud firewall port restrictions)
  if (getBrevoKey()) {
    try {
      return await sendViaBrevoHTTP(options);
    } catch (brevoErr) {
      console.warn(`[Email/Brevo HTTP] API error (${brevoErr.response?.data?.message || brevoErr.message}) — trying fallback`);
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
