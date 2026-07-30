const { body } = require("express-validator");

/**
 * Validator for POST /api/users (register)
 */
const registerValidator = [
  body("name")
    .trim()
    .notEmpty().withMessage("Name is required.")
    .isLength({ min: 2, max: 80 }).withMessage("Name must be 2–80 characters."),

  body("email")
    .trim()
    .notEmpty().withMessage("Email is required.")
    .isEmail().withMessage("Please provide a valid email address.")
    .normalizeEmail(),

  body("password")
    .notEmpty().withMessage("Password is required.")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters.")
    .matches(/[A-Z]/).withMessage("Password must contain at least one uppercase letter.")
    .matches(/[0-9]/).withMessage("Password must contain at least one number."),

  body("role")
    .optional()
    .isIn(["student", "recruiter"]).withMessage("Role must be either 'student' or 'recruiter'."),

  body("githubUsername")
    .optional()
    .trim()
    .isLength({ max: 39 }).withMessage("GitHub username must be under 39 characters.")
    .matches(/^[a-zA-Z0-9-]*$/).withMessage("GitHub username can only contain letters, numbers, and hyphens."),
];

/**
 * Validator for POST /api/users/login
 */
const loginValidator = [
  body("email")
    .trim()
    .notEmpty().withMessage("Email is required.")
    .isEmail().withMessage("Please provide a valid email address.")
    .normalizeEmail(),

  body("password")
    .notEmpty().withMessage("Password is required."),
];

/**
 * Validator for POST /api/users/forgotpassword
 */
const forgotPasswordValidator = [
  body("email")
    .trim()
    .notEmpty().withMessage("Email is required.")
    .isEmail().withMessage("Please provide a valid email address.")
    .normalizeEmail(),
];

/**
 * Validator for PUT /api/users/resetpassword/:resettoken
 */
const resetPasswordValidator = [
  body("password")
    .notEmpty().withMessage("New password is required.")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters.")
    .matches(/[A-Z]/).withMessage("Password must contain at least one uppercase letter.")
    .matches(/[0-9]/).withMessage("Password must contain at least one number."),
];

/**
 * Validator for PUT /api/users/profile (when changing password)
 * Note: currentPassword is only required if a new password is provided.
 */
const updateProfileValidator = [
  body("name")
    .optional()
    .trim()
    .isLength({ min: 2, max: 80 }).withMessage("Name must be 2–80 characters."),

  body("email")
    .optional()
    .trim()
    .isEmail().withMessage("Please provide a valid email address.")
    .normalizeEmail(),

  body("password")
    .optional()
    .isLength({ min: 8 }).withMessage("New password must be at least 8 characters.")
    .matches(/[A-Z]/).withMessage("Password must contain at least one uppercase letter.")
    .matches(/[0-9]/).withMessage("Password must contain at least one number."),

  body("currentPassword")
    .if(body("password").exists({ checkFalsy: true }))
    .notEmpty().withMessage("Current password is required to set a new password."),

  body("phone")
    .optional()
    .trim()
    .matches(/^[+\d\s\-()]*$/).withMessage("Phone number contains invalid characters."),

  body("website")
    .optional()
    .trim()
    .custom((val) => {
      if (!val) return true;
      try { new URL(val); return true; } catch { throw new Error("Website must be a valid URL."); }
    }),

  body("linkedin")
    .optional()
    .trim()
    .custom((val) => {
      if (!val) return true;
      try { new URL(val); return true; } catch { throw new Error("LinkedIn must be a valid URL."); }
    }),

  body("profileVisibility")
    .optional()
    .isIn(["public", "recruiters-only", "private"]).withMessage("Invalid profile visibility value."),
];

module.exports = {
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  updateProfileValidator,
};
