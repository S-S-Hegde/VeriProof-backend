const mongoose = require("mongoose");

const aiMetricsSchema = mongoose.Schema(
  {
    correlationId: {
      type: String,
      required: true,
      index: true,
    },
    taskName: {
      type: String,
      required: true,
    },
    capability: {
      type: String,
      default: "JSON_EXTRACTION",
    },
    provider: {
      type: String,
      required: true,
    },
    model: {
      type: String,
      required: true,
    },
    promptVersion: {
      type: String,
      default: "1.0",
    },
    cached: {
      type: Boolean,
      default: false,
    },
    latencyMs: {
      type: Number,
      default: 0,
    },
    promptTokens: {
      type: Number,
      default: 0,
    },
    completionTokens: {
      type: Number,
      default: 0,
    },
    estimatedCostUsd: {
      type: Number,
      default: 0.0,
    },
    success: {
      type: Boolean,
      default: true,
    },
    errorMessage: {
      type: String,
      default: "",
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

const AIMetrics = mongoose.model("AIMetrics", aiMetricsSchema);
module.exports = AIMetrics;
