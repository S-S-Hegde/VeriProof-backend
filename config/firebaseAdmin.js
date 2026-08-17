const admin = require("firebase-admin");
const { cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const path = require("path");

let isInitialized = false;
let lastInitError = null;

const cleanPrivateKey = (raw) => {
  if (!raw) return null;
  let key = String(raw).trim();
  // Strip quotes if user pasted into Render with surrounding quotes
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  // Convert literal escaped newlines to real newlines
  key = key.replace(/\\n/g, "\n");
  key = key.replace(/\r\n/g, "\n");
  return key;
};

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

  const projectId = process.env.FIREBASE_PROJECT_ID ? process.env.FIREBASE_PROJECT_ID.trim() : null;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ? process.env.FIREBASE_CLIENT_EMAIL.trim() : null;
  const privateKey = cleanPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  try {
    // Strategy 1: FIREBASE_SERVICE_ACCOUNT_KEY contains JSON string or Base64 (Render env var)
    if (serviceAccountRaw && typeof serviceAccountRaw === "string") {
      let rawString = serviceAccountRaw.trim();

      if (
        (rawString.startsWith('"') && rawString.endsWith('"')) ||
        (rawString.startsWith("'") && rawString.endsWith("'"))
      ) {
        rawString = rawString.slice(1, -1).trim();
      }

      if (!rawString.startsWith("{")) {
        try {
          const decoded = Buffer.from(rawString, "base64").toString("utf8");
          if (decoded.trim().startsWith("{")) {
            rawString = decoded.trim();
          }
        } catch (e) {
          // not base64
        }
      }

      if (rawString.startsWith("{")) {
        try {
          const serviceAccount = JSON.parse(rawString);
          if (serviceAccount.private_key) {
            serviceAccount.private_key = cleanPrivateKey(serviceAccount.private_key);
          }
          admin.initializeApp({
            credential: cert(serviceAccount),
          });
          isInitialized = true;
          lastInitError = null;
          console.log("[Firebase Admin] Initialized via service account JSON string.");
          return true;
        } catch (jsonErr) {
          lastInitError = `JSON parse error: ${jsonErr.message}`;
          console.error("[Firebase Admin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON string:", jsonErr.message);
        }
      }
    }

    // Strategy 2: FIREBASE_SERVICE_ACCOUNT_KEY is a local file path
    if (serviceAccountRaw && typeof serviceAccountRaw === "string") {
      const fs = require("fs");
      const resolvedPath = path.isAbsolute(serviceAccountRaw)
        ? serviceAccountRaw
        : path.resolve(process.cwd(), serviceAccountRaw);

      if (fs.existsSync(resolvedPath)) {
        const serviceAccount = require(resolvedPath);
        if (serviceAccount.private_key) {
          serviceAccount.private_key = cleanPrivateKey(serviceAccount.private_key);
        }
        admin.initializeApp({
          credential: cert(serviceAccount),
        });
        isInitialized = true;
        lastInitError = null;
        console.log("[Firebase Admin] Initialized via service account JSON file.");
        return true;
      }
    }

    // Strategy 3: Individual Environment Variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)
    if (projectId && clientEmail && privateKey) {
      try {
        admin.initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
        isInitialized = true;
        lastInitError = null;
        console.log("[Firebase Admin] Initialized via individual environment variables.");
        return true;
      } catch (certErr) {
        lastInitError = `Individual vars cert error: ${certErr.message}`;
        console.error("[Firebase Admin] Error initializing with individual vars:", certErr.message);
      }
    } else {
      const missing = [];
      if (!projectId) missing.push("FIREBASE_PROJECT_ID");
      if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
      if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY");
      if (!serviceAccountRaw) missing.push("FIREBASE_SERVICE_ACCOUNT_KEY");
      lastInitError = `Missing server credentials: ${missing.join(", ")}`;
    }

    // Strategy 4: Try loading default serviceAccountKey.json if present in config directory
    try {
      const defaultPath = path.resolve(__dirname, "serviceAccountKey.json");
      const fs = require("fs");
      if (fs.existsSync(defaultPath)) {
        const serviceAccount = require(defaultPath);
        admin.initializeApp({
          credential: cert(serviceAccount),
        });
        isInitialized = true;
        lastInitError = null;
        console.log("[Firebase Admin] Initialized via default config/serviceAccountKey.json.");
        return true;
      }
    } catch (e) {
      // ignore
    }

    isInitialized = false;
    return false;
  } catch (err) {
    lastInitError = err.message;
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
      `Firebase Admin SDK is not configured on the server (${lastInitError || "Missing credentials"}). Please configure FIREBASE_PROJECT_ID and credentials in Render.`
    );
  }

  try {
    // Check revocation (checkRevoked = true)
    const auth = typeof admin.auth === "function" ? admin.auth() : getAuth();
    const decodedToken = await auth.verifyIdToken(idToken, true);
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
