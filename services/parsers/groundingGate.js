/**
 * Deterministic Grounding Gate.
 * Validates that every extracted fact is grounded directly in the document text.
 * Requires evidence_quote to be a verbatim substring of sourceText,
 * and value to appear inside evidence_quote.
 * Any ungrounded field is set to null and logged in ungrounded_fields.
 */

function normalizeText(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\p{L}\p{N}\s%./-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a value appears in the quote (handling strings, numbers, dates).
 */
function isValueInsideQuote(val, quote) {
  if (val === null || val === undefined) return true;
  const normQuote = normalizeText(quote);
  const normVal = normalizeText(String(val));

  if (!normVal) return true;
  if (normQuote.includes(normVal)) return true;

  // Number/percentage check: "73" in "73%"
  const numVal = normVal.replace(/[^0-9.]/g, "");
  if (numVal && normQuote.replace(/[^0-9.]/g, "").includes(numVal)) {
    return true;
  }

  // Date check: YYYY-MM-DD vs "07-03-2026" or "March 7, 2026"
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(val))) {
    const [year, month, day] = String(val).split("-");
    const dayInt = parseInt(day, 10).toString();
    if (normQuote.includes(year) && (normQuote.includes(day) || normQuote.includes(dayInt))) {
      return true;
    }
  }

  return false;
}

/**
 * Runs grounding gate on extracted structured fields against rawText.
 * Returns { groundedFields, ungroundedFields }
 */
function applyGroundingGate(rawFields, rawText) {
  const normRawText = normalizeText(rawText);
  const ungroundedFields = [];
  const grounded = {};

  function verifyField(fieldName, fieldObj) {
    if (!fieldObj || fieldObj.value === null || fieldObj.value === undefined) {
      return { value: null, evidence_quote: null, source: "text", confidence: 0 };
    }

    const quote = fieldObj.evidence_quote || "";
    const normQuote = normalizeText(quote);

    // 1. Quote must be substring of source text
    const quoteInText = normQuote.length > 0 && normRawText.includes(normQuote);

    // 2. Value must appear inside quote
    const valueInQuote = isValueInsideQuote(fieldObj.value, quote);

    if (quoteInText && valueInQuote) {
      return {
        value: fieldObj.value,
        evidence_quote: quote,
        source: fieldObj.source || "text",
        confidence: fieldObj.confidence || 0.95,
      };
    } else {
      ungroundedFields.push(fieldName);
      return {
        value: null,
        evidence_quote: null,
        source: "text",
        confidence: 0,
      };
    }
  }

  // Singular fields
  grounded.document_type = verifyField("document_type", rawFields.document_type);
  grounded.title = verifyField("title", rawFields.title);
  grounded.issuer_as_printed = verifyField("issuer_as_printed", rawFields.issuer_as_printed);
  grounded.recipient_name = verifyField("recipient_name", rawFields.recipient_name);
  grounded.issue_date = verifyField("issue_date", rawFields.issue_date);
  grounded.expiry_date = verifyField("expiry_date", rawFields.expiry_date);
  grounded.period_or_session = verifyField("period_or_session", rawFields.period_or_session);
  grounded.duration_hours = verifyField("duration_hours", rawFields.duration_hours);
  grounded.credits = verifyField("credits", rawFields.credits);
  grounded.grade_or_level = verifyField("grade_or_level", rawFields.grade_or_level);

  // Array fields: identifiers
  grounded.identifiers = [];
  if (Array.isArray(rawFields.identifiers)) {
    rawFields.identifiers.forEach((idItem, idx) => {
      const v = verifyField(`identifiers[${idx}]:${idItem.label_as_printed || "id"}`, idItem);
      if (v.value !== null) {
        grounded.identifiers.push({
          label_as_printed: idItem.label_as_printed || "Identifier",
          value: v.value,
          evidence_quote: v.evidence_quote,
          source: v.source,
          confidence: v.confidence,
        });
      }
    });
  }

  // Array fields: scores
  grounded.scores = [];
  if (Array.isArray(rawFields.scores)) {
    rawFields.scores.forEach((scoreItem, idx) => {
      const v = verifyField(`scores[${idx}]:${scoreItem.label_as_printed || "score"}`, scoreItem);
      if (v.value !== null) {
        grounded.scores.push({
          label_as_printed: scoreItem.label_as_printed || "Score",
          value: v.value,
          max: scoreItem.max || null,
          unit: scoreItem.unit || null,
          evidence_quote: v.evidence_quote,
          source: v.source,
          confidence: v.confidence,
        });
      }
    });
  }

  // Array fields: signatories
  grounded.signatories = [];
  if (Array.isArray(rawFields.signatories)) {
    rawFields.signatories.forEach((sigItem, idx) => {
      const sigVal = sigItem.name ? sigItem : { ...sigItem, value: sigItem.name };
      const v = verifyField(`signatories[${idx}]`, sigVal);
      if (v.value !== null) {
        grounded.signatories.push({
          name: sigItem.name || v.value,
          role: sigItem.role || null,
          organisation: sigItem.organisation || null,
          evidence_quote: v.evidence_quote,
          source: v.source,
          confidence: v.confidence,
        });
      }
    });
  }

  // Array fields: extras
  grounded.extras = [];
  if (Array.isArray(rawFields.extras)) {
    rawFields.extras.forEach((extraItem, idx) => {
      const v = verifyField(`extras[${idx}]:${extraItem.label_as_printed || "extra"}`, extraItem);
      if (v.value !== null) {
        grounded.extras.push({
          label_as_printed: extraItem.label_as_printed || "Detail",
          value: v.value,
          evidence_quote: v.evidence_quote,
          source: v.source,
          confidence: v.confidence,
        });
      }
    });
  }

  return { grounded, ungroundedFields };
}

module.exports = {
  applyGroundingGate,
  normalizeText,
};
