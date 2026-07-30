require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testFlash25() {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      }
    });
    const result = await model.generateContent("Return a JSON array of 3 fruit names");
    console.log("gemini-2.5-flash JSON response:", result.response.text());
  } catch (e) {
    console.error("gemini-2.5-flash failed:", e.message);
  }
}

testFlash25();
