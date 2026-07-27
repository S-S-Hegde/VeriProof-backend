const axios = require("axios");

// Configure the internal client to point to the FastAPI server
const aiEngineClient = axios.create({
  baseURL: process.env.AI_ENGINE_URL || "http://127.0.0.1:8000",
  timeout: 45000, // AI requests (like Gemini) can take a few seconds
  headers: {
    "Content-Type": "application/json",
    "x-internal-api-key":
      process.env.INTERNAL_API_KEY || "veriproof-dev-secret",
  },
});

/**
 * Proxies request payload from Node.js Controller to Python FastAPI Engine
 * @param {string} endpoint - The Python API route (e.g., '/api/extract-claims-pdf')
 * @param {object} data - The JSON payload to send
 */
const postToAiEngine = async (endpoint, data) => {
  try {
    const response = await aiEngineClient.post(endpoint, data);
    return response.data;
  } catch (error) {
    console.error(
      `[AI Microservice Error] Failed to call ${endpoint}:`,
      error.response?.data || error.message,
    );
    throw new Error(
      error.response?.data?.detail ||
        "AI Processing Engine Service Unavailable",
    );
  }
};

module.exports = { postToAiEngine };
 