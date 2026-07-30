const { validationResult } = require("express-validator");

/**
 * Runs express-validator checks and returns 422 with formatted errors if any fail.
 * Usage: router.post("/", [...validatorChain], validate, handler)
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Return only the first error per field for clean UX
    const formatted = {};
    for (const error of errors.array()) {
      if (!formatted[error.path]) {
        formatted[error.path] = error.msg;
      }
    }
    return res.status(422).json({
      message: "Validation failed. Please check your input.",
      errors: formatted,
    });
  }
  next();
};

module.exports = validate;
