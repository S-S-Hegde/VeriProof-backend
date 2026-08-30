/**
 * githubRoutes.js
 *
 * Routes for the candidate GitHub intelligence pipeline.
 * These routes are candidate-only (not recruiter).
 */

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { getStatus, runGitHubAnalysis } = require("../services/githubIntelligenceService");
const User = require("../models/User");

/**
 * GET /api/github/status
 * Returns current GitHub analysis status for the logged-in candidate.
 * Used by the frontend to poll and update the Verification Journey live.
 */
router.get("/status", protect, async (req, res) => {
  try {
    const status = await getStatus(req.user._id);
    res.json(status);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/github/trigger
 * Manually (re-)trigger the GitHub analysis pipeline for the logged-in candidate.
 * Used when candidate clicks the "Repository Analysis" step in the Verification Journey
 * or when they update their GitHub username.
 */
router.post("/trigger", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (req.body && req.body.githubUsername && typeof req.body.githubUsername === "string") {
      user.githubUsername = req.body.githubUsername.trim();
      await user.save();
    }

    if (!user.githubUsername) {
      return res.status(400).json({
        message: "No GitHub username on your profile. Please add one in Profile Settings.",
      });
    }

    const current = await getStatus(req.user._id);
    if (current.status === "running") {
      return res.json({
        message: "GitHub analysis is already running.",
        status: current,
      });
    }

    // Fire and forget
    runGitHubAnalysis(req.user._id).catch((err) => {
      console.error("[GitHub Routes] Trigger error:", err.message);
    });

    res.json({
      message: "GitHub analysis started.",
      githubUsername: user.githubUsername,
      status: "running",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
