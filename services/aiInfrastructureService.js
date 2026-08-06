const crypto = require("crypto");
const AIMetrics = require("../models/AIMetrics");

const AICapabilities = {
  JSON_EXTRACTION: "JSON_EXTRACTION",
  STRUCTURED_VALIDATION: "STRUCTURED_VALIDATION",
  LONG_FORM_GENERATION: "LONG_FORM_GENERATION",
  CODE_ANALYSIS: "CODE_ANALYSIS",
  CODE_GRADING: "CODE_GRADING",
  REPOSITORY_UNDERSTANDING: "REPOSITORY_UNDERSTANDING",
  CLASSIFICATION: "CLASSIFICATION",
  RANKING: "RANKING",
  BEHAVIORAL_REASONING: "BEHAVIORAL_REASONING",
  EXECUTIVE_SUMMARIZATION: "EXECUTIVE_SUMMARIZATION",
  EVIDENCE_FUSION: "EVIDENCE_FUSION",
  TRUST_SCORING: "TRUST_SCORING",
};

const cache = new Map();

const generateCorrelationId = () => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `AI-${dateStr}-${rand}`;
};

const generateCacheKey = (taskName, promptVersion, payload) => {
  const hash = crypto
    .createHash("sha256")
    .update(`${taskName}:v${promptVersion}:${JSON.stringify(payload)}`)
    .digest("hex");
  return `ai_cache:${taskName}:${hash}`;
};

const logAIMetric = async (metricData) => {
  try {
    await AIMetrics.create(metricData);
  } catch (err) {
    console.warn("[AIMetrics] Logging failed:", err.message);
  }
};

const executeAITask = async ({
  taskName,
  capability = AICapabilities.JSON_EXTRACTION,
  promptVersion = "1.0",
  payload,
  candidateId = null,
  executor,
}) => {
  const correlationId = generateCorrelationId();
  const cacheKey = generateCacheKey(taskName, promptVersion, payload);

  // Check in-memory cache for deterministic tasks
  if (cache.has(cacheKey)) {
    const cachedItem = cache.get(cacheKey);
    if (cachedItem.expiresAt > Date.now()) {
      console.log(`[${correlationId}] [Cache HIT] Task '${taskName}'`);
      logAIMetric({
        correlationId,
        taskName,
        capability,
        provider: "cache",
        model: "in_memory",
        promptVersion,
        cached: true,
        latencyMs: 1,
        success: true,
        candidateId,
      });
      return cachedItem.data;
    } else {
      cache.delete(cacheKey);
    }
  }

  const startTime = Date.now();
  try {
    const result = await executor({ correlationId });
    const latencyMs = Date.now() - startTime;

    // Cache successful output
    cache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });

    logAIMetric({
      correlationId,
      taskName,
      capability,
      provider: result.provider || "gemini",
      model: result.model || "gemini-2.0-flash",
      promptVersion,
      cached: false,
      latencyMs,
      success: true,
      candidateId,
    });

    return result;
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    console.error(`[${correlationId}] [AI Infrastructure] Task '${taskName}' failed:`, err.message);

    logAIMetric({
      correlationId,
      taskName,
      capability,
      provider: "gemini",
      model: "gemini-2.0-flash",
      promptVersion,
      cached: false,
      latencyMs,
      success: false,
      errorMessage: err.message,
      candidateId,
    });

    throw err;
  }
};

module.exports = {
  AICapabilities,
  generateCorrelationId,
  executeAITask,
};
