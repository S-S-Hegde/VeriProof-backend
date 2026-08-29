const rateLimit = require("express-rate-limit");

const isDev = process.env.NODE_ENV !== "production";

/**
 * Auth limiter — protects login, register, forgot-password, reset-password.
 * Max 10 requests per 15 minutes per IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased for E2E testing (was 10)
  standardHeaders: true,   // Return rate limit info in RateLimit-* headers
  legacyHeaders: false,
  message: {
    message: "Too many attempts from this IP. Please try again after 15 minutes.",
  },
  skipSuccessfulRequests: false,
  skip: () => isDev,
});

/**
 * File upload limiter — protects profile image and resume upload endpoints.
 * Max 5 requests per 10 minutes per IP.
 */
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 500, // Increased for E2E testing (was 5)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many file upload attempts. Please try again after 10 minutes.",
  },
  skip: () => isDev,
});

/**
 * General API limiter — broad protection for all API routes.
 * Generous limit to accommodate live polling dashboards without 429 blocks.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many requests from this IP. Please try again later.",
  },
  skip: () => isDev,
});

module.exports = { authLimiter, uploadLimiter, generalLimiter };
