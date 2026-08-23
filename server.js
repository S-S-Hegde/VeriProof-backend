const dns = require("dns");
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

const express = require("express");
const dotenv = require("dotenv");
dotenv.config();

const cors = require("cors");
const mongoose = require("mongoose");
const { connectDB, isDBConnected } = require("./config/db");
const { generalLimiter } = require("./middleware/rateLimiter");

// Route files
const authRoutes    = require("./routes/authRoutes");
const projectRoutes = require("./routes/projectRoutes");
const verifyRoutes  = require("./routes/verifyRoutes");
const examRoutes    = require("./routes/examRoutes");
const skillTreeRoutes = require("./routes/skillTreeRoutes");
const githubRoutes  = require("./routes/githubRoutes");

// Initialize DB connection asynchronously (non-blocking)
connectDB();

const app = express();

// Refined Production CORS
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow non-browser clients (curl, Postman, server-to-server)
      if (!origin) return callback(null, true);

      const normalizedOrigin = origin.replace(/\/$/, "");
      const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/$/, "");

      const allowedOrigins = [
        frontendUrl,
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
      ].filter(Boolean);

      // Match explicit allowed origins
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }

      // Automatically support all Vercel deployments (*.vercel.app)
      if (
        /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i.test(normalizedOrigin) ||
        (process.env.ADDITIONAL_ALLOWED_ORIGINS &&
          process.env.ADDITIONAL_ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/$/, "")).includes(normalizedOrigin))
      ) {
        return callback(null, true);
      }

      console.warn(`[CORS Blocked] Origin not allowed: ${origin}`);
      return callback(new Error("CORS: origin not allowed: " + origin));
    },
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Lightweight Render Health Check (Zero DB dependency)
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "veriproof-backend",
  });
});

// Dependency Readiness Check (Reports DB readiness)
app.get("/ready", (req, res) => {
  if (isDBConnected()) {
    return res.status(200).json({
      status: "ready",
      service: "veriproof-backend",
      database: "connected",
    });
  }
  return res.status(503).json({
    status: "not_ready",
    service: "veriproof-backend",
    database: "connecting",
  });
});

// Basic root route
app.get("/", (req, res) => {
  res.send("VeriProof API is running...");
});

// Apply a broad rate limit across all /api routes
app.use("/api", generalLimiter);

// Ensure upload directories exist
const path = require("path");
const fs = require("fs");
const uploadDir = path.join(__dirname, "uploads", "recruiter-resumes");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve uploaded files statically with open CORS
app.use(
  "/uploads",
  (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.header("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "uploads"))
);

// Dynamic fallback route for recruiter resumes if container restarted
app.get("/uploads/recruiter-resumes/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;
    const localFilePath = path.join(__dirname, "uploads", "recruiter-resumes", filename);
    if (fs.existsSync(localFilePath)) {
      return res.sendFile(localFilePath);
    }

    const RecruiterApplicant = require("./models/RecruiterApplicant");
    const applicant = await RecruiterApplicant.findOne({
      $or: [
        { fileUrl: new RegExp(filename.replace(/\.pdf$/i, ""), "i") },
        { fileUrl: `/uploads/recruiter-resumes/${filename}` },
      ],
    });

    if (applicant && applicant.resumeText) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${applicant.name || "candidate"}-resume.txt"`
      );
      return res.send(
        `====================================================\nVERIPROOF VERIFIED RESUME RECORD\nCandidate: ${applicant.name || "Candidate"}\nEmail: ${applicant.extractedEmail || "N/A"}\n====================================================\n\n${applicant.resumeText}`
      );
    }

    return res.status(404).send("Document not available on server.");
  } catch (e) {
    return res.status(500).send("Error reading document.");
  }
});

// Mount API routes
app.use("/api/users", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/verify", verifyRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/skill-tree", skillTreeRoutes);
app.use("/api/github", githubRoutes);

// Global Error Handler — never leak internals in production
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  const isDev = process.env.NODE_ENV !== "production";
  res.status(statusCode).json({
    message: isDev ? err.message : "An unexpected server error occurred.",
    stack: isDev ? err.stack : undefined,
  });
});

const PORT = process.env.PORT || 10000;

const server = app.listen(PORT, "0.0.0.0", () =>
  console.log(`VeriProof backend listening on port ${PORT}`)
);

// Graceful Shutdown (SIGTERM / SIGINT)
const handleGracefulShutdown = async (signal) => {
  console.log(`[Server] ${signal} received. Starting graceful shutdown...`);

  server.close(async () => {
    console.log("[Server] HTTP server closed.");
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
        console.log("[MongoDB] Connection closed cleanly.");
      }
    } catch (err) {
      console.error("[MongoDB] Error closing connection:", err.message);
    }
    process.exit(0);
  });

  // Force exit after 5 seconds if connections hang
  setTimeout(() => {
    console.error("[Server] Forced shutdown after timeout.");
    process.exit(1);
  }, 5000);
};

process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));

