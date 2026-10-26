const { extractUniversalCertificate } = require("./universalExtractor");

/**
 * Universal Document Extractor entrypoint.
 * Zero per-issuer parsers. Universal schema output.
 */
async function parseCertificateDocument(buffer, mimeType = "application/pdf", originalFilename = "") {
  const result = await extractUniversalCertificate(buffer, mimeType, originalFilename);

  // Map backwards-compatible flat convenience properties
  return {
    ...result,
    title_as_printed: result.title?.value || null,
    issuer_as_printed: result.issuer_as_printed?.value || null,
    issuer_canonical: result.issuer_canonical?.value || null,
    recipient_as_printed: result.recipient_name?.value || null,
    certificate_type: result.document_type?.evidence_quote || result.document_type?.value || null,
    issue_date: result.issue_date?.value || null,
    credential_id: result.identifiers[0]?.value || null,
    verification_url: result.verification_urls[0]?.url || null,
    signatory: result.signatories[0]?.evidence_quote || result.signatories[0]?.name || null,
    session_or_period: result.period_or_session?.value || null,
    score_details: {
      consolidated_score: result.scores.find((s) => s.unit === "%")?.value || null,
      online_assignments: result.scores.find((s) => s.label_as_printed.toLowerCase().includes("assignment"))?.value || null,
      proctored_exam: result.scores.find((s) => s.label_as_printed.toLowerCase().includes("exam"))?.value || null,
      candidates_certified: parseInt(result.extras.find((e) => e.label_as_printed.toLowerCase().includes("candidates"))?.value || "0", 10) || null,
      credits_recommended: result.credits?.value || null,
      elite_badge: result.scores.some((s) => s.value === "Elite"),
    },
    qr_raw: result.qr_payloads[0]?.raw || null,
  };
}

module.exports = {
  parseCertificateDocument,
  extractUniversalCertificate,
};
