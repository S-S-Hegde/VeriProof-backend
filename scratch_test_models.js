require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listModels() {
  try {
    // There isn't a direct listModels on GoogleGenerativeAI, but let's see if we can do a simple request or test a different model name like gemini-pro
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent("test");
    console.log("gemini-pro worked:", result.response.text());
  } catch (e) {
    console.error("gemini-pro failed:", e.message);
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const result = await model.generateContent("test");
    console.log("gemini-1.5-flash-latest worked:", result.response.text());
  } catch (e) {
    console.error("gemini-1.5-flash-latest failed:", e.message);
  }
}

listModels();
