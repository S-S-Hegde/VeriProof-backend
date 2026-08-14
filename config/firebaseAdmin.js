const admin = require("firebase-admin");

let isInitialized = false;

const initFirebaseAdmin = () => {
  if (isInitialized) return true;
  if (admin && admin.apps && Array.isArray(admin.apps) && admin.apps.length > 0) {
    isInitialized = true;
    return true;
  }

  if (!process.env.FIREBASE_PROJECT_ID) {
    try {
      require("dotenv").config();
    } catch (e) {
      // Ignore if dotenv is not available
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || null;
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  try {
    if (serviceAccountPath) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      isInitialized = true;
      console.log("[Firebase Admin] Initialized via service account JSON file.");
      return true;
    } else if (projectId && clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      isInitialized = true;
      console.log("[Firebase Admin] Initialized via environment variables.");
      return true;
    } else {
      isInitialized = false;
      return false;
    }
  } catch (err) {
    console.error("[Firebase Admin] Failed to initialize Admin SDK:", err.message);
    isInitialized = false;
    return false;
  }
};

// Attempt initial setup on load
initFirebaseAdmin();

class FirebaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "FirebaseConfigError";
    this.statusCode = 503;
  }
}

class FirebaseTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = "FirebaseTokenError";
    this.statusCode = 401;
  }
}

/**
 * Cryptographically verify Firebase ID token server-side.
 * MUST ALWAYS use Firebase Admin SDK verification.
 * NO fallback decoding or mock verification in production code.
 */
const verifyFirebaseIdToken = async (idToken) => {
  if (!idToken) {
    throw new FirebaseTokenError("No Firebase ID token provided.");
  }

  const ready = initFirebaseAdmin();
  if (!ready) {
    throw new FirebaseConfigError(
      "Firebase Admin SDK is not configured on the server. Please configure FIREBASE_PROJECT_ID and credentials."
    );
  }

  try {
    // Check revocation (checkRevoked = true)
    const decodedToken = await admin.auth().verifyIdToken(idToken, true);
    return decodedToken;
  } catch (err) {
    console.error("[Firebase Admin] Token verification failed:", err.message);
    throw new FirebaseTokenError(`Firebase token verification failed: ${err.message}`);
  }
};

module.exports = {
  admin,
  initFirebaseAdmin,
  verifyFirebaseIdToken,
  FirebaseConfigError,
  FirebaseTokenError,
};
