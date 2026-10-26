const { deriveSkillsFromTitle } = require("./skillDeriver");

/**
 * Deterministic Parser for Infosys Springboard Certificates
 * Matches against printed layout structure:
 * [RECIPIENT]
 * [TITLE]
 * The certificate is awarded to
 * for successfully completing the [course | program]
 * on [Month DD, YYYY]
 * Issued on: [Weekday, Month DD, YYYY]
 * To verify, scan the QR code at https://verify.onwingspan.com
 */
function parseInfosysSpringboard(rawText, qrData = null) {
  if (!rawText) return null;

  const isInfosys =
    /verify\.onwingspan\.com/i.test(rawText) ||
    /Infosys\s+Springboard/i.test(rawText) ||
    /Infosys\s+Limited/i.test(rawText) ||
    (qrData && typeof qrData === "string" && qrData.includes("onwingspan.com"));

  if (!isInfosys) return null;

  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Locate the anchor line: "The certificate is awarded to"
  const awardIdx = lines.findIndex((l) => /The certificate is awarded to/i.test(l));

  let recipient = null;
  let title = null;

  if (awardIdx >= 2) {
    recipient = lines[awardIdx - 2];
    title = lines[awardIdx - 1];
  } else if (awardIdx === 1) {
    title = lines[0];
  }

  // Double check title & recipient against QR verifiable credential payload if available
  let qrParsed = null;
  let credentialId = null;
  if (qrData) {
    try {
      qrParsed = typeof qrData === "string" ? JSON.parse(qrData) : qrData;
      if (qrParsed.credentialSubject?.issuedTo && !recipient) {
        recipient = qrParsed.credentialSubject.issuedTo;
      }
      if (qrParsed.credentialSubject?.course && !title) {
        title = qrParsed.credentialSubject.course;
      }
      if (qrParsed.id) {
        credentialId = qrParsed.id;
      }
    } catch (e) {}
  }

  // Type: Course Completion Certificate vs Program Completion Certificate
  let certType = "Course Completion Certificate";
  if (/completing the program/i.test(rawText)) {
    certType = "Program Completion Certificate";
  } else if (/completing the course/i.test(rawText)) {
    certType = "Course Completion Certificate";
  }

  // Issued Date: e.g. "Issued on: Saturday, March 7, 2026" or "on March 7, 2026"
  // Format as YYYY-MM-DD
  let issueDate = null;
  const dateMatch = rawText.match(/(?:Issued on:\s*(?:[A-Za-z]+,\s*)?|on\s+)([A-Za-z]+\s+\d{1,2},\s*\d{4})/i);
  if (dateMatch) {
    const rawDate = dateMatch[1];
    const parsed = new Date(rawDate);
    if (!isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, "0");
      const day = String(parsed.getDate()).padStart(2, "0");
      issueDate = `${year}-${month}-${day}`;
    }
  }

  const { skills, subject } = deriveSkillsFromTitle(title);

  return {
    matched: true,
    title_as_printed: title,
    issuer_as_printed: "Infosys Limited, Infosys Springboard",
    issuer_canonical: "Infosys Springboard",
    certificate_type: certType,
    recipient_as_printed: recipient,
    issue_date: issueDate,
    signatory:
      "Satheesha B. Nanjappa, Senior Vice President and Head, Education, Training and Assessment, Infosys Limited",
    session_or_period: null,
    credential_id: credentialId, // None printed on document
    score_details: null,
    verification_url: "https://verify.onwingspan.com",
    qr_raw: qrData,
    skills,
    subject,
    extraction_method: "template",
    field_sources: {
      title: "template",
      issuer: "template",
      recipient: "template",
      certificate_type: "template",
      issue_date: "template",
      signatory: "template",
      verification_url: "template",
    },
  };
}

module.exports = { parseInfosysSpringboard };
