const { body } = require("express-validator");

/**
 * Validator for POST /api/projects (create project)
 */
const createProjectValidator = [
  body("title")
    .trim()
    .notEmpty().withMessage("Project title is required.")
    .isLength({ min: 2, max: 120 }).withMessage("Title must be 2–120 characters."),

  body("description")
    .trim()
    .notEmpty().withMessage("Project description is required.")
    .isLength({ min: 10, max: 2000 }).withMessage("Description must be 10–2000 characters."),

  body("technologies")
    .isArray({ min: 1 }).withMessage("At least one technology is required.")
    .custom((arr) => {
      if (!arr.every((t) => typeof t === "string" && t.trim().length > 0)) {
        throw new Error("Each technology must be a non-empty string.");
      }
      if (arr.length > 30) throw new Error("Too many technologies listed (max 30).");
      return true;
    }),

  body("repositoryUrl")
    .trim()
    .notEmpty().withMessage("Repository URL is required.")
    .isURL({ protocols: ["http", "https"], require_protocol: true })
    .withMessage("Repository URL must be a valid URL (http/https).")
    .custom((val) => {
      if (!val.includes("github.com") && !val.includes("gitlab.com") && !val.includes("bitbucket.org")) {
        throw new Error("Repository URL must point to GitHub, GitLab, or Bitbucket.");
      }
      return true;
    }),

  body("liveUrl")
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ protocols: ["http", "https"], require_protocol: true })
    .withMessage("Live URL must be a valid URL (http/https)."),

  body("images")
    .optional()
    .isArray().withMessage("Images must be an array.")
    .custom((arr) => {
      if (arr && arr.length > 10) throw new Error("Maximum 10 images allowed.");
      return true;
    }),
];

module.exports = { createProjectValidator };
