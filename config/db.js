const mongoose = require("mongoose");

const RETRY_INTERVALS_MS = [1000, 2000, 5000, 10000, 30000];

const isDBConnected = () => mongoose.connection.readyState === 1;

const connectDB = async () => {
  let attempt = 0;

  const attemptConnect = async () => {
    try {
      if (!process.env.MONGO_URI) {
        console.warn("[MongoDB] MONGO_URI is not set. Database operations will remain unavailable.");
        return;
      }

      const conn = await mongoose.connect(process.env.MONGO_URI);
      console.log(`[MongoDB] Connected successfully: ${conn.connection.host}`);
    } catch (error) {
      const nextDelay = RETRY_INTERVALS_MS[Math.min(attempt, RETRY_INTERVALS_MS.length - 1)];
      attempt++;
      console.error(`[MongoDB] Connection attempt ${attempt} failed: ${error.message}. Retrying in ${nextDelay / 1000}s...`);

      setTimeout(attemptConnect, nextDelay);
    }
  };

  attemptConnect();
};

module.exports = { connectDB, isDBConnected };

