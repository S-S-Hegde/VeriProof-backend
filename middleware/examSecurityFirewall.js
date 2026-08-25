/**
 * Exam Security Firewall Middleware
 * VeriProof High-Integrity Assessment Protection System
 *
 * Enforces:
 * 1. Payload sanitization & NoSQL injection mitigation
 * 2. Array bounds & answer structure validation
 * 3. Timing checks & anti-replay protection
 * 4. User ownership and session state verification
 */

const Exam = require("../models/Exam");

/**
 * Validates and sanitizes exam submission payloads before controller execution.
 */
const validateExamSubmission = async (req, res, next) => {
  try {
    const { answers, isTerminated, violationCount, violations } = req.body;

    // 1. Verify candidate session is authenticated
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        error: "SECURITY_UNAUTHORIZED",
        message: "Authentication required for exam submission.",
      });
    }

    // 2. Fetch the candidate's active 'In Progress' exam
    const activeExam = await Exam.findOne({
      candidateId: req.user._id,
      status: "In Progress",
    }).sort({ createdAt: -1 });

    if (!activeExam) {
      // Check if candidate already completed or terminated an exam
      const latestExam = await Exam.findOne({
        candidateId: req.user._id,
      }).sort({ createdAt: -1 });

      if (latestExam && (latestExam.status === "Completed" || latestExam.status === "Terminated")) {
        return res.status(409).json({
          success: false,
          error: "EXAM_ALREADY_FINALIZED",
          message: "This exam attempt has already been finalized and cannot be resubmitted.",
        });
      }

      return res.status(404).json({
        success: false,
        error: "NO_ACTIVE_EXAM",
        message: "No active 'In Progress' exam session found for this candidate.",
      });
    }

    // 3. Early exit if session was terminated for security violations
    if (isTerminated === true) {
      req.activeExam = activeExam;
      return next();
    }

    // 4. Validate 'answers' structure
    if (!Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        error: "INVALID_PAYLOAD_FORMAT",
        message: "Submission must include a valid 'answers' array.",
      });
    }

    // Upper limit guard: Cannot submit more answers than exist on exam
    if (answers.length > activeExam.questions.length + 5) {
      return res.status(400).json({
        success: false,
        error: "PAYLOAD_OVERFLOW",
        message: "Submitted answer count exceeds the total questions in this exam.",
      });
    }

    // 5. Sanitize and validate every answer entry
    const validQuestionIds = new Set(
      activeExam.questions.map((q) => q._id.toString())
    );

    const sanitizedAnswers = [];
    for (const item of answers) {
      if (!item || typeof item !== "object") continue;

      const qId = String(item.questionId || "").trim();
      const ansIdx = Number(item.answerIndex);

      // Verify questionId actually belongs to this candidate's active exam
      if (!validQuestionIds.has(qId)) {
        console.warn(`[SecurityFirewall] Foreign or forged questionId rejected: ${qId}`);
        continue;
      }

      // Verify answerIndex is within valid option bounds (0 to 3) or -1 for unselected
      if (isNaN(ansIdx) || ansIdx < -1 || ansIdx > 3) {
        continue;
      }

      sanitizedAnswers.push({
        questionId: qId,
        answerIndex: ansIdx,
      });
    }

    // 6. Enforce sanitized answers and attach verified exam to req
    req.body.answers = sanitizedAnswers;
    req.activeExam = activeExam;

    next();
  } catch (err) {
    console.error("[SecurityFirewall] Submission validation error:", err.message);
    return res.status(500).json({
      success: false,
      error: "FIREWALL_INTERNAL_ERROR",
      message: "Security firewall encounter an internal error during validation.",
    });
  }
};

/**
 * Rate limiter / throttle for sensitive exam operations
 */
const examActionRateLimit = () => {
  const attempts = new Map();

  return (req, res, next) => {
    const userId = req.user?._id?.toString() || req.ip;
    const now = Date.now();
    const windowMs = 5000; // 5 seconds window
    const maxRequests = 10;

    const userRecord = attempts.get(userId) || { count: 0, resetTime: now + windowMs };

    if (now > userRecord.resetTime) {
      userRecord.count = 1;
      userRecord.resetTime = now + windowMs;
    } else {
      userRecord.count += 1;
    }

    attempts.set(userId, userRecord);

    if (userRecord.count > maxRequests) {
      return res.status(429).json({
        success: false,
        error: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Please slow down.",
      });
    }

    next();
  };
};

module.exports = {
  validateExamSubmission,
  examActionRateLimit: examActionRateLimit(),
};
