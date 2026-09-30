const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");

// 1. Gemini
const callGemini = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
  });

  const result = await model.generateContent(prompt);
  return (result.response.text() || "").replace(/```json|```/g, "").trim();
};

// 2. NVIDIA NIM (OpenAI compatible)
const callNvidiaNim = async (prompt) => {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("Missing NVIDIA_API_KEY");

  const response = await axios.post(
    "https://integrate.api.nvidia.com/v1/chat/completions",
    {
      model: "meta/llama-3.1-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 1024,
      response_format: { type: "json_object" }
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

  return response.data.choices[0].message.content;
};

// 3. Mistral
const callMistral = async (prompt) => {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("Missing MISTRAL_API_KEY");

  const response = await axios.post(
    "https://api.mistral.ai/v1/chat/completions",
    {
      model: "mistral-large-latest",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      response_format: { type: "json_object" }
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

  return response.data.choices[0].message.content;
};

// 4. Cohere
const callCohere = async (prompt) => {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error("Missing COHERE_API_KEY");

  const response = await axios.post(
    "https://api.cohere.ai/v1/generate",
    {
      model: "command-r-plus",
      prompt: prompt,
      temperature: 0.4,
      max_tokens: 1024
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    }
  );

  return response.data.generations[0].text;
};

const providers = [
  { name: "gemini", fn: callGemini, env: "GEMINI_API_KEY" },
  { name: "nvidia_nim", fn: callNvidiaNim, env: "NVIDIA_API_KEY" },
  { name: "mistral", fn: callMistral, env: "MISTRAL_API_KEY" },
  { name: "cohere", fn: callCohere, env: "COHERE_API_KEY" }
];

/**
 * Validates basic JSON structure from LLM response
 */
const validateJSON = (rawText) => {
  try {
    const text = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text);
    return parsed;
  } catch (e) {
    throw new Error("Invalid JSON structure returned by LLM");
  }
};

/**
 * Generate with fallback chain
 */
const generateWithFallback = async (prompt, validatorFn = null) => {
  for (const provider of providers) {
    if (!process.env[provider.env] && !(provider.env === "GEMINI_API_KEY" && process.env.GOOGLE_API_KEY)) {
      continue;
    }

    try {
      console.log(`[LLMRouter] Attempting generation with ${provider.name}...`);
      const rawResponse = await provider.fn(prompt);
      
      const parsed = validateJSON(rawResponse);
      
      if (validatorFn) {
        if (!validatorFn(parsed)) {
          throw new Error(`Response failed domain validation for ${provider.name}`);
        }
      }
      
      console.log(`[LLMRouter] Success with ${provider.name}`);
      return parsed;
    } catch (err) {
      console.warn(`[LLMRouter] Provider ${provider.name} failed:`, err.message);
    }
  }

  throw new Error("All configured LLM providers failed");
};

const getProviderHealth = () => {
  const health = {};
  for (const p of providers) {
    health[p.name] = !!(process.env[p.env] || (p.env === "GEMINI_API_KEY" && process.env.GOOGLE_API_KEY));
  }
  return health;
};

module.exports = {
  generateWithFallback,
  getProviderHealth
};
