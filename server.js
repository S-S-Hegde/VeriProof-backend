const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");
const { generalLimiter } = require("./middleware/rateLimiter");

// Route files
const authRoutes    = require("./routes/authRoutes");
const projectRoutes = require("./routes/projectRoutes");
const verifyRoutes  = require("./routes/verifyRoutes");
const examRoutes    = require("./routes/examRoutes");
const skillTreeRoutes = require("./routes/skillTreeRoutes");

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
  optionsSuccessStatus: 200,
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Apply a broad rate limit across all API routes
app.use("/api", generalLimiter);

// Serve uploaded files (profile images) statically
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Basic route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Mount routes
app.use("/api/users", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/verify", verifyRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/skill-tree", skillTreeRoutes);

// Global Error Handler — never leak internals in production
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  const isDev = process.env.NODE_ENV !== "production";
  res.status(statusCode).json({
    message: isDev ? err.message : "An unexpected server error occurred.",
    stack: isDev ? err.stack : undefined,
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, console.log(`Server running on port ${PORT}`));
