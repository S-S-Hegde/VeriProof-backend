const axios = require("axios");
const { deriveSkillsFromTitle } = require("./skillDeriver");

/**
 * Normalizes string for strict substring presence validation.
 */
function normalizeForSubstringCheck(str) {
  if (!str) return "";
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Generic Fallback Parser using LLM with Strict Substring Anti-Hallucination Rejection.
 * Returns null for any field that cannot be proven to exist verbatim in the source text.
 */
async function parseGenericWithLlm(rawText, qrUrl = null) {
  if (!rawText || rawText.trim().length < 10) {
    return {
      title_as_printed: null,
      issuer_as_printed: null,
      issuer_canonical: null,
      certificate_type: "Certificate",
      recipient_as_printed: null,
      issue_date: null,
      signatory: null,
      session_or_period: null,
      credential_id: null,
      score_details: null,
      verification_url: qrUrl || null,
      skills: [],
      subject: null,
      extraction_method: "ocr_llm",
      field_sources: {},
    };
  }

  const apiKey = process.env.GROQ_API_KEY;
  let parsed = null;

  if (apiKey) {
    const prompt = `You are a forensic certificate auditor.
EXTRACT STRICT TRUTH:
Return null for any field not printed on the document. Never guess, never infer a title or issuer, copy text exactly as printed.

Return ONLY a JSON object matching this exact schema:
{
  "title_as_printed": string or null,
  "issuer_as_printed": string or null,
  "issuer_canonical": string or null,
  "certificate_type": string or null,
  "recipient_as_printed": string or null,
  "issue_date": "YYYY-MM-DD" or null,
  "signatory": string or null,
  "credential_id": string or null,
  "session_or_period": string or null
}

DOCUMENT TEXT:
${rawText.substring(0, 3500)}
`;

    try {
      const res = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: "qwen/qwen3.8-27b",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          temperature: 0.0,
          max_tokens: 800,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 8000,
        }
      );
      const content = res.data?.choices?.[0]?.message?.content;
      if (content) {
        parsed = JSON.parse(content.trim());
      }
    } catch (err) {
      console.warn("[Generic Parser] LLM fallback warning:", err.message);
    }
  }

  // Anti-hallucination substring check against source text
  const normalizedSource = normalizeForSubstringCheck(rawText);

  const verifyField = (val) => {
    if (!val || typeof val !== "string") return null;
    const norm = normalizeForSubstringCheck(val);
    if (!norm || norm.length < 3) return null;
    return normalizedSource.includes(norm) ? val.trim() : null;
  };

  const title = verifyField(parsed?.title_as_printed);
  const issuer = verifyField(parsed?.issuer_as_printed);
  const recipient = verifyField(parsed?.recipient_as_printed);
  const credentialId = verifyField(parsed?.credential_id);
  const signatory = verifyField(parsed?.signatory);

  const { skills, subject } = deriveSkillsFromTitle(title);

  return {
    matched: Boolean(title || issuer),
    title_as_printed: title,
    issuer_as_printed: issuer,
    issuer_canonical: parsed?.issuer_canonical || issuer,
    certificate_type: parsed?.certificate_type || "Certificate",
    recipient_as_printed: recipient,
    issue_date: parsed?.issue_date || null,
    signatory,
    session_or_period: parsed?.session_or_period || null,
    credential_id: credentialId,
    score_details: null,
    verification_url: qrUrl || null,
    skills,
    subject,
    extraction_method: "ocr_llm",
    field_sources: {
      title: title ? "llm" : "none",
      issuer: issuer ? "llm" : "none",
      recipient: recipient ? "llm" : "none",
      issue_date: parsed?.issue_date ? "llm" : "none",
    },
  };
}

module.exports = { parseGenericWithLlm };
