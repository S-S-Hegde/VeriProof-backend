const jwt = require("jsonwebtoken");
const User = require("../models/User.js");
const { verifyFirebaseIdToken, FirebaseConfigError, FirebaseTokenError } = require("../config/firebaseAdmin");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      // Try verifying app JWT session token first
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findById(decoded.id).select("-password");
        if (!req.user) {
          return res.status(401).json({ message: "User account no longer exists or has been deleted." });
        }
        return next();
      } catch (jwtErr) {
        // If JWT token verification failed, check if it's a raw Firebase ID token
        const firebaseDecoded = await verifyFirebaseIdToken(token);
        let user = await User.findOne({ firebaseUid: firebaseDecoded.uid });
        if (!user && firebaseDecoded.email) {
          user = await User.findOne({ email: firebaseDecoded.email.trim().toLowerCase() });
        }
        if (!user) {
          return res.status(401).json({ message: "No application user associated with this verified Firebase token." });
        }
        req.user = user;
        req.firebaseUser = firebaseDecoded;
        return next();
      }
    } catch (error) {
      if (error instanceof FirebaseConfigError) {
        return res.status(503).json({ message: error.message });
      }
      return res.status(401).json({ message: error.message || "Not authorized, token verification failed." });
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token provided." });
  }
};

const requireFirebaseToken = async (req, res, next) => {
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    const token = req.headers.authorization.split(" ")[1];
    try {
      const decodedToken = await verifyFirebaseIdToken(token);
      req.firebaseUser = decodedToken; // contains uid, email, name, picture
      return next();
    } catch (error) {
      const statusCode = error.statusCode || 401;
      return res.status(statusCode).json({ message: error.message });
    }
  }

  return res.status(401).json({ message: "Mandatory Firebase ID token missing in Authorization header." });
};

const requireVerifiedIdentity = (req, res, next) => {
  if (req.user && req.user.identityVerified) {
    next();
  } else {
    res.status(403).json({ message: "Mandatory Google identity verification required before accessing this feature." });
  }
};

const recruiterOnly = (req, res, next) => {
  if (req.user && req.user.role === "recruiter") {
    next();
  } else {
    res.status(401).json({ message: "Not authorized as a recruiter" });
  }
};

module.exports = {
  protect,
  requireFirebaseToken,
  requireVerifiedIdentity,
  recruiterOnly,
};
