const mongoose = require("mongoose");

const RETRY_INTERVALS_MS = [1000, 2000, 5000, 10000, 30000];

const isDBConnected = () => mongoose.connection.readyState === 1;

const connectDB = async () => {
  let attempt = 0;

  const attemptConnect = async () => {
    try {
      const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

      if (!uri) {
        console.warn(
          "[MongoDB] Neither MONGO_URI nor MONGODB_URI is set. Please set MONGO_URI in Render Environment Variables."
        );
        return;
      }

      const conn = await mongoose.connect(uri);
      console.log(`[MongoDB] Connected successfully: ${conn.connection.host}`);
    } catch (error) {
      const nextDelay = RETRY_INTERVALS_MS[Math.min(attempt, RETRY_INTERVALS_MS.length - 1)];
      attempt++;
      console.error(
        `[MongoDB] Connection attempt ${attempt} failed: ${error.message}. Retrying in ${nextDelay / 1000}s...`
      );

      setTimeout(attemptConnect, nextDelay);
    }
  };

  attemptConnect();
};

module.exports = { connectDB, isDBConnected };

