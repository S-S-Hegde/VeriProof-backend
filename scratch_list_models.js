require('dotenv').config();
const axios = require('axios');

async function listAllModels() {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  
  try {
    const res = await axios.get(url);
    console.log("Success! Status:", res.status);
    console.log("Models:");
    res.data.models.forEach(m => {
      console.log(`- ${m.name} (displayName: ${m.displayName}, supportedMethods: ${m.supportedMethods?.join(', ')})`);
    });
  } catch (e) {
    console.log("Error status:", e.response?.status);
    console.log("Error data:", JSON.stringify(e.response?.data, null, 2));
  }
}

listAllModels();
