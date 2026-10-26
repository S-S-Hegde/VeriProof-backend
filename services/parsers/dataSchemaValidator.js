const fs = require("fs");
const path = require("path");

const ALLOWED_TRUSTED_VERIFIER_KEYS = new Set([
  "host",
  "registered_domain",
  "issuer_hint",
  "issuer_as_printed",
  "description",
  "content_type",
  "trusted",
]);

const ALLOWED_ISSUER_ALIAS_KEYS = new Set([
  "pattern",
  "canonical_name",
  "domain",
]);

/**
 * Validates trusted_verifiers.json against strict schema.
 * Rejects unknown keys, missing required fields, and personal data.
 */
function validateTrustedVerifiersSchema(items) {
  if (!Array.isArray(items)) {
    throw new Error("trusted_verifiers.json must be a top-level JSON array.");
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item !== "object" || item === null) {
      throw new Error(`trusted_verifiers[${i}] must be an object.`);
    }

    // Check unknown keys
    for (const key of Object.keys(item)) {
      if (!ALLOWED_TRUSTED_VERIFIER_KEYS.has(key)) {
        throw new Error(`Schema validation error: Unknown key "${key}" in trusted_verifiers.json at index ${i}`);
      }
    }

    if (!item.host || typeof item.host !== "string") {
      throw new Error(`trusted_verifiers[${i}] missing required string field "host"`);
    }
    if (!item.registered_domain || typeof item.registered_domain !== "string") {
      throw new Error(`trusted_verifiers[${i}] missing required string field "registered_domain"`);
    }
  }

  return true;
}

/**
 * Validates issuer_aliases.json against strict schema.
 * Rejects unknown keys, missing required fields, and personal data.
 */
function validateIssuerAliasesSchema(items) {
  if (!Array.isArray(items)) {
    throw new Error("issuer_aliases.json must be a top-level JSON array.");
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item !== "object" || item === null) {
      throw new Error(`issuer_aliases[${i}] must be an object.`);
    }

    // Check unknown keys
    for (const key of Object.keys(item)) {
      if (!ALLOWED_ISSUER_ALIAS_KEYS.has(key)) {
        throw new Error(`Schema validation error: Unknown key "${key}" in issuer_aliases.json at index ${i}`);
      }
    }

    if (!item.pattern || typeof item.pattern !== "string") {
      throw new Error(`issuer_aliases[${i}] missing required string field "pattern"`);
    }
    if (!item.canonical_name || typeof item.canonical_name !== "string") {
      throw new Error(`issuer_aliases[${i}] missing required string field "canonical_name"`);
    }
  }

  return true;
}

/**
 * Reads and validates both files on startup.
 */
function loadAndValidateDataFiles() {
  const verifiersPath = path.join(__dirname, "../../data/trusted_verifiers.json");
  const aliasesPath = path.join(__dirname, "../../data/issuer_aliases.json");

  if (!fs.existsSync(verifiersPath)) {
    throw new Error(`trusted_verifiers.json not found at ${verifiersPath}`);
  }
  if (!fs.existsSync(aliasesPath)) {
    throw new Error(`issuer_aliases.json not found at ${aliasesPath}`);
  }

  const verifiers = JSON.parse(fs.readFileSync(verifiersPath, "utf-8"));
  const aliases = JSON.parse(fs.readFileSync(aliasesPath, "utf-8"));

  validateTrustedVerifiersSchema(verifiers);
  validateIssuerAliasesSchema(aliases);

  return { verifiers, aliases };
}

module.exports = {
  validateTrustedVerifiersSchema,
  validateIssuerAliasesSchema,
  loadAndValidateDataFiles,
};
