const axios = require("axios");
const pdfParse = require("pdf-parse");

const PYTHON_API_BASE =
  process.env.PYTHON_API_BASE || "http://127.0.0.1:8000/api";

const analyzeResumeBuffer = async (buffer, options = {}) => {
  try {
    let text = "";

    // 1. Direct PDF Extraction
    if (options.mimeType === "application/pdf") {
      // Standard call, bypassing the complex wrapper
      let parsePdf = pdfParse;
      if (typeof parsePdf !== "function" && parsePdf && parsePdf.default) {
        parsePdf = parsePdf.default;
      }

      const pdfData = await parsePdf(buffer);
      text = pdfData.text;
    } else {
      text = buffer.toString("utf8");
    }

    if (!text || text.trim().length === 0) {
      throw new Error("No readable text found in document.");
    }

    // 2. Send to Python AI for Analysis
    const pythonRes = await axios.post(`${PYTHON_API_BASE}/extract-skills`, {
      text: text,
    });

    // 3. Format output to match what your controllers expect
    return {
      normalizedText: text,
      claims: {
        skills: pythonRes.data.result.skills || [],
      },
      analysis: pythonRes.data.result.analysis || {},
    };
  } catch (error) {
    console.error("[Intelligence Service] Error:", error.message);
    throw error;
  }
};

module.exports = {
  analyzeResumeBuffer,
};
