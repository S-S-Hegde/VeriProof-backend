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
  const key2 = (process.env.BREVO_API_KEY_2 || process.env.BREVO_API_KEY2 || "").trim();
  const sender2 = (process.env.FROM_EMAIL_2 || process.env.BREVO_API_KEY2_email || sender1).trim();
  if (key2) accounts.push({ key: key2, sender: sender2, id: "Brevo-Account-2" });

  // Account 3
  const key3 = (process.env.BREVO_API_KEY_3 || process.env.BREVO_API_KEY3 || "").trim();
  const sender3 = (process.env.FROM_EMAIL_3 || process.env.BREVO_API_KEY3_email || sender1).trim();
  if (key3) accounts.push({ key: key3, sender: sender3, id: "Brevo-Account-3" });

  // Account 4
  const key4 = (process.env.BREVO_API_KEY_4 || process.env.BREVO_API_KEY4 || "").trim();
  const sender4 = (process.env.FROM_EMAIL_4 || process.env.BREVO_API_KEY4_email || sender1).trim();
  if (key4) accounts.push({ key: key4, sender: sender4, id: "Brevo-Account-4" });

  // Account 5
  const key5 = (process.env.BREVO_API_KEY_5 || process.env.BREVO_API_KEY5 || "").trim();
  const sender5 = (process.env.FROM_EMAIL_5 || process.env.BREVO_API_KEY5_email || sender1).trim();
  if (key5) accounts.push({ key: key5, sender: sender5, id: "Brevo-Account-5" });

  return accounts;
};

const getResendKey = () => (process.env.RESEND_API_KEY || "").trim();

const hasRealSMTP = () =>
  !!(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());

// ── Helper: Extract OTP or Verification Code from Options or Content ────────
const extractOtpCode = (options) => {
  if (options.otp) return String(options.otp).trim();
  if (options.code && /^\d{4,8}$/.test(String(options.code).trim())) return String(options.code).trim();

  // Pattern 1: Look in subject line
  if (options.subject) {
    const subjectMatch = options.subject.match(/\b(\d{6})\b/) || options.subject.match(/\b(\d{4,8})\b/);
    if (subjectMatch && /(?:code|otp|verify|verification|pin|security|sign-in|reset|auth)/i.test(options.subject)) {
      return subjectMatch[1];
    }
  }

  // Pattern 2: Look in HTML content for styled OTP blocks
  if (options.html) {
    // 2a. Big numeric text block (font-size 30px+ or letter-spacing 8px+)
    const bigNumMatch = options.html.match(/(?:letter-spacing|font-size:[^"']*?[3-5]\dpx)[^>]*>\s*([0-9]{4,8})\s*</i);
    if (bigNumMatch) return bigNumMatch[1];

    // 2b. Contextual match near keyword
    const contextMatch = options.html.match(/(?:code|otp|pin|password)[^0-9<]{1,60}\b([0-9]{6})\b/i);
    if (contextMatch) return contextMatch[1];

    // 2c. Standalone 6-digit block inside tags
    const tagMatch = options.html.match(/>\s*([0-9]{6})\s*</);
    if (tagMatch) return tagMatch[1];
  }

  return null;
};

// ── Helper: Prepare Email Payload with Gmail OTP Card Annotations ───────────
const prepareEmailContent = (options) => {
  const otpCode = extractOtpCode(options);
  let finalHtml = options.html || `<p>${options.message || options.text || ""}</p>`;

  let rawText = (
    options.message ||
    options.text ||
    (options.html ? options.html.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim() : "") ||
    "VeriProof Verification Code"
  );

  let textContent = rawText;

  // Build standard transactional headers
  const headers = {
    "X-Auto-Response-Suppress": "All",
    "Auto-Submitted": "auto-generated",
    ...(options.headers || {}),
  };

  if (otpCode) {
    // 1. Transactional OTP Headers (Recognized by Gmail, Apple Mail, and ESP relays)
    headers["X-OTP"] = String(otpCode);
    headers["X-Verification-Code"] = String(otpCode);
    headers["X-Entity-Ref-ID"] = `vp-otp-${Date.now()}-${otpCode}`;

    // 2. Structured Data Schema.org Markup & Invisible Preheader
    // NOTE: This markup is 100% invisible to human eyes (display:none, 0 opacity, 0 height)
    // and makes zero visual UI changes, but gives Gmail's ML and heuristic parser the exact
    // signals needed to render the interactive "Code Requested [ Copy code ]" card.
    const jsonLdMarkup = `
<!-- Gmail OTP & Schema.org Extraction Annotations (Zero visual layout impact) -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "EmailMessage",
  "description": "Your VeriProof verification code is ${otpCode}",
  "potentialAction": {
    "@type": "ViewAction",
    "name": "Copy Code: ${otpCode}",
    "target": "${options.actionUrl || "https://veriproof.app"}"
  }
}
</script>
<div style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
  Your verification code is ${otpCode}. Use this code to verify your VeriProof account. (Expires in 10 minutes)
</div>
<div itemscope itemtype="http://schema.org/EmailMessage" style="display:none;max-height:0px;overflow:hidden;">
  <meta itemprop="description" content="Your verification code is ${otpCode}" />
</div>
`;

    // Inject invisible Schema.org markup cleanly right after <body> or at the top
    if (finalHtml.includes("<body")) {
      finalHtml = finalHtml.replace(/(<body[^>]*>)/i, `$1\n${jsonLdMarkup}\n`);
    } else if (finalHtml.includes("<html")) {
      finalHtml = finalHtml.replace(/(<html[^>]*>)/i, `$1\n${jsonLdMarkup}\n`);
    } else {
      finalHtml = `${jsonLdMarkup}\n${finalHtml}`;
    }

    // 3. Clean Multipart text/plain stream
    // Gmail's heuristic parser scans text/plain first; placing the standard OTP sentence
    // at the top guarantees immediate regex extraction for the quick-copy action pill.
    if (!rawText.startsWith("Your verification code is")) {
      textContent = `Your verification code is: ${otpCode}\n\nUse this code to verify your VeriProof account. This code expires in 10 minutes.\n\n${rawText}`;
    }
  }

  return { finalHtml, textContent, headers, otpCode };
};

// ── Provider 1: Multi-Account Brevo HTTPS REST API (Port 443 — 100% Free & Open) ───
const sendViaBrevoHTTP = async (options, account, enriched) => {
  const senderName = (process.env.FROM_NAME || "VeriProof Platform").trim();

  const payload = {
    sender: { name: senderName, email: account.sender },
    to: [{ email: options.email }],
    subject: options.subject,
    htmlContent: enriched.finalHtml,
    textContent: enriched.textContent,
    headers: enriched.headers,
  };

  const { data } = await axios.post("https://api.brevo.com/v3/smtp/email", payload, {
    headers: {
      "api-key": account.key,
      "Content-Type": "application/json",
    },
    timeout: 8000,
  });

  console.log(`✅ [Email/${account.id} HTTP] Delivered → ${options.email} (messageId: ${data.messageId})${enriched.otpCode ? ` [OTP: ${enriched.otpCode}]` : ""}`);
  return data;
};

// ── Provider 2: Resend HTTPS REST API (Port 443) ────────────────────────
const sendViaResendHTTP = async (options, enriched) => {
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
    html: enriched.finalHtml,
    text: enriched.textContent,
    headers: enriched.headers,
  };

  const { data } = await axios.post("https://api.resend.com/emails", payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    timeout: 8000,
  });

  console.log(`✅ [Email/Resend HTTP] Delivered → ${options.email} (id: ${data.id})${enriched.otpCode ? ` [OTP: ${enriched.otpCode}]` : ""}`);
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
  const enriched = prepareEmailContent(options);

  // Try 1: Brevo Multi-Account Pool (Port 443 - Round-Robin Load Balanced + Auto-Failover)
  const brevoAccounts = getBrevoAccounts();
  if (brevoAccounts.length > 0) {
    for (let i = 0; i < brevoAccounts.length; i++) {
      const targetAccount = brevoAccounts[(currentBrevoIndex + i) % brevoAccounts.length];
      try {
        const result = await sendViaBrevoHTTP(options, targetAccount, enriched);
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
      return await sendViaResendHTTP(options, enriched);
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
      html: enriched.finalHtml,
      text: enriched.textContent,
      headers: enriched.headers,
    };

    try {
      const info = await transporter.sendMail(message);
      console.log(`✅ [Email/SMTP] Delivered → ${options.email} (messageId: ${info.messageId})${enriched.otpCode ? ` [OTP: ${enriched.otpCode}]` : ""}`);
      return info;
    } catch (smtpErr) {
      console.error(`❌ [Email/SMTP Error] Failed → ${options.email}:`, smtpErr.message);
      throw smtpErr;
    }
  }

  console.warn(`⚠️ [Email Warning] No working email credentials configured.`);
};

module.exports = sendEmail;
