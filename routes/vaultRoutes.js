const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const { syncVault, getVaultMetrics } = require("../controllers/vaultController");

// @route   POST /api/vault/sync
// @desc    Trigger real-time GitHub commit tracking and vault sync
// @access  Private (Candidate)
router.post("/sync", protect, syncVault);

// @route   GET /api/vault/metrics
// @desc    Retrieve aggregated vault provenance metrics
// @access  Private (Candidate)
router.get("/metrics", protect, getVaultMetrics);

module.exports = router;
