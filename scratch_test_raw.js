require('dotenv').config();
const axios = require('axios');

async function testRawCall() {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
  
  try {
    const res = await axios.post(url, {
      contents: [{ parts: [{ text: "Hello" }] }]
    });
    console.log("Success! Status:", res.status);
    console.log("Data:", JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.log("Error status:", e.response?.status);
    console.log("Error headers:", e.response?.headers);
    console.log("Error data:", JSON.stringify(e.response?.data, null, 2));
  }
}

testRawCall();
