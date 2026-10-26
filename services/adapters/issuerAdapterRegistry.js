const { verifyUniversalCertificate, compareNamesTokenSubset } = require("../verification/universalVerifier");

/**
 * Backwards-compatibility wrapper for universal certificate verification.
 * Zero issuer-specific code. All verification flows through universal strategies (S1-S4).
 */
async function verifyWithIssuerAdapter(extractedData, accountUser = null) {
  return await verifyUniversalCertificate(extractedData, accountUser);
}

module.exports = {
  verifyWithIssuerAdapter,
  compareNamesTokenSubset,
};
