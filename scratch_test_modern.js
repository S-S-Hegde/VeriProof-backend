require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testModels() {
  const models = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-2.0-flash"];
  for (const m of models) {
    try {
      const model = genAI.getGenerativeModel({
        model: m,
        generationConfig: {
          responseMimeType: "application/json",
        }
      });
      const result = await model.generateContent("Return a JSON array of 3 fruit names");
      console.log(`✅ ${m} worked! Response:`, result.response.text().trim());
      break;
    } catch (e) {
      console.error(`❌ ${m} failed:`, e.message);
    }
  }
}

testModels();
