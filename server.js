const dns = require("dns");
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (_) {}

const express = require("express");
const dotenv = require("dotenv");
dotenv.config();

const cors = require("cors");
const axios = require("axios");
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

// Activity Tracking for Render Free-Tier Keep-Alive
global.lastClientActivity = Date.now();
const PYTHON_API_BASE = process.env.AI_ENGINE_URL || "https://python-engine-adw8.onrender.com";

// Lightweight Render Health Check (Zero DB dependency)
app.get(["/health", "/api/health"], (req, res) => {
  try {
    const dbConnected = typeof isDBConnected === "function" ? isDBConnected() : false;
    res.status(200).json({
      status: "ok",
      service: "veriproof-backend",
      db: dbConnected,
      timestamp: new Date().toISOString(),
    });
  } catch (_) {
    res.status(200).json({
      status: "ok",
      service: "veriproof-backend",
      timestamp: new Date().toISOString(),
    });
  }
});

// Dependency Readiness Check (Reports DB readiness)
app.get(["/ready", "/api/ready"], (req, res) => {
  try {
    const dbConnected = typeof isDBConnected === "function" ? isDBConnected() : false;
    if (dbConnected) {
      return res.status(200).json({
        status: "ready",
        service: "veriproof-backend",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    }
    return res.status(200).json({
      status: "degraded",
      service: "veriproof-backend",
      database: "connecting",
      timestamp: new Date().toISOString(),
    });
  } catch (_) {
    return res.status(200).json({
      status: "degraded",
      service: "veriproof-backend",
      database: "unknown",
      timestamp: new Date().toISOString(),
    });
  }
});

// Keep-Alive Ping endpoint (Pings backend & Python engine while active users exist)
app.get(["/api/keep-alive", "/keep-alive", "/api/ping", "/ping"], (req, res) => {
  try {
    global.lastClientActivity = Date.now();

    // Check database state non-blockingly without throwing
    let dbConnected = false;
    try {
      dbConnected = typeof isDBConnected === "function" ? isDBConnected() : false;
    } catch (_) {
      dbConnected = false;
    }

    // Async warmup ping to Python AI Engine (fire-and-forget, non-blocking)
    try {
      axios.get(`${PYTHON_API_BASE}/health`, { timeout: 4000 }).catch(() => {});
    } catch (_) {}

    return res.status(200).json({
      status: dbConnected ? "alive" : "degraded",
      db: dbConnected,
      timestamp: new Date().toISOString(),
      service: "veriproof-backend",
      awake: true,
      pythonEngine: "warming",
      lastActivity: global.lastClientActivity,
    });
  } catch (err) {
    // Ultra-safe fallback for uptime monitors (always returns 200)
    return res.status(200).json({
      status: "alive",
      timestamp: new Date().toISOString(),
    });
  }
});

app.post(["/api/keep-alive/release", "/keep-alive/release"], (req, res) => {
  // Candidate / User logged out or closed session
  res.status(200).json({ status: "released", timestamp: new Date().toISOString() });
});

// Basic root route
app.get("/", (req, res) => {
  res.send("VeriProof API is running...");
});

// Track activity across all incoming API calls
app.use("/api", (req, res, next) => {
  global.lastClientActivity = Date.now();
  next();
});

// Apply a broad rate limit across all /api routes
app.use("/api", generalLimiter);

// ── Autonomous Background Keep-Alive Watchdog (Every 3.5 Minutes) ──
setInterval(async () => {
  try {
    const timeSinceLastActivity = Date.now() - (global.lastClientActivity || 0);
    const IDLE_LIMIT = 14 * 60 * 1000; // 14 minutes

    if (timeSinceLastActivity < IDLE_LIMIT) {
      const elapsedMinutes = Math.round(timeSinceLastActivity / 60000);
      console.log(`[KeepAlive Watchdog] Active user detected (${elapsedMinutes}m ago). Keeping Node.js backend & Python AI engine awake.`);
      try {
        await axios.get(`${PYTHON_API_BASE}/health`, { timeout: 5000 });
      } catch (e) {
        console.log(`[KeepAlive Watchdog] Python Engine warm ping sent.`);
      }
    }
  } catch (_) {
    // Graceful error suppression for background timer
  }
}, 3.5 * 60 * 1000);

// Ensure upload directories exist
const path = require("path");
const fs = require("fs");
const uploadDirs = [
  path.join(__dirname, "uploads", "resumes"),
  path.join(__dirname, "uploads", "recruiter-resumes"),
  path.join(__dirname, "uploads", "violations"),
];
uploadDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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

// Helper to stamp the sleek VeriProof Verified banner on any PDF
const stampVeriproofHeader = async (pdfBuffer) => {
  try {
    const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    if (pages.length > 0) {
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();

      const bannerHeight = 36;
      const bannerY = height - bannerHeight;

      // Draw top header background band (Dark slate #0d1226)
      firstPage.drawRectangle({
        x: 0,
        y: bannerY,
        width: width,
        height: bannerHeight,
        color: rgb(13 / 255, 18 / 255, 38 / 255),
      });

      // Embed standard bold font
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Title: VERIPROOF VERIFIED RESUME (Blue #6b8aff)
      firstPage.drawText("VERIPROOF VERIFIED RESUME", {
        x: 20,
        y: bannerY + 18,
        size: 11,
        font: helveticaBold,
        color: rgb(107 / 255, 138 / 255, 255 / 255),
      });

      // Subtitle: Official Recruiter Candidate Dossier
      firstPage.drawText("Official Candidate Dossier • Anti-Fraud Security Verified", {
        x: 20,
        y: bannerY + 6,
        size: 7.5,
        font: helvetica,
        color: rgb(148 / 255, 160 / 255, 184 / 255),
      });
    }

    const modifiedPdfBytes = await pdfDoc.save();
    return Buffer.from(modifiedPdfBytes);
  } catch (err) {
    console.warn("[Header Stamp Note]", err.message);
    return pdfBuffer; // fallback to original buffer if stamping fails
  }
};

// Universal dynamic streaming route for candidate resumes & recruiter resumes (Exact Original Uploaded Format)
app.get(["/uploads/resumes/:filename", "/uploads/recruiter-resumes/:filename"], async (req, res) => {
  try {
    const filename = req.params.filename;
    const isRecruiter = req.path.includes("recruiter-resumes");
    const folder = isRecruiter ? "recruiter-resumes" : "resumes";
    const localFilePath = path.join(__dirname, "uploads", folder, filename);

    // 1. If physical file exists on disk, stream original exact binary PDF bytes
    if (fs.existsSync(localFilePath)) {
      const fileBytes = fs.readFileSync(localFilePath);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.send(fileBytes);
    }

    const User = require("./models/User");
    const ResumeAnalysis = require("./models/ResumeAnalysis");
    const RecruiterApplicant = require("./models/RecruiterApplicant");

    // 2. Query User for candidate self-uploaded resumes
    const userDoc = await User.findOne({
      $or: [
        { resumeUrl: new RegExp(filename.replace(/\.pdf$/i, ""), "i") },
        { resumeUrl: `/uploads/resumes/${filename}` },
        { resumeUrl: `/uploads/recruiter-resumes/${filename}` },
      ],
    });

    if (userDoc && userDoc.resumeFileBase64) {
      const pdfBuffer = Buffer.from(userDoc.resumeFileBase64, "base64");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${userDoc.originalFileName || filename}"`);
      return res.send(pdfBuffer);
    }

    // 3. Query ResumeAnalysis for candidate self-uploaded resumes
    const analysisDoc = await ResumeAnalysis.findOne({
      $or: [
        { resumeUrl: new RegExp(filename.replace(/\.pdf$/i, ""), "i") },
        { resumeUrl: `/uploads/resumes/${filename}` },
        { originalFileName: new RegExp(filename.replace(/\.pdf$/i, ""), "i") },
      ],
    });

    if (analysisDoc && analysisDoc.fileBufferBase64) {
      const pdfBuffer = Buffer.from(analysisDoc.fileBufferBase64, "base64");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${analysisDoc.originalFileName || filename}"`);
      return res.send(pdfBuffer);
    }

    // 4. Query RecruiterApplicant for recruiter-uploaded resumes
    const applicant = await RecruiterApplicant.findOne({
      $or: [
        { fileUrl: new RegExp(filename.replace(/\.pdf$/i, ""), "i") },
        { fileUrl: `/uploads/recruiter-resumes/${filename}` },
        { fileUrl: `/uploads/resumes/${filename}` },
        { originalFileName: new RegExp(filename.replace(/\.pdf$/i, ""), "i") },
      ],
    });

    if (applicant && applicant.fileBufferBase64) {
      const pdfBuffer = Buffer.from(applicant.fileBufferBase64, "base64");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${applicant.originalFileName || filename}"`
      );
      return res.send(pdfBuffer);
    }

    return res.status(404).send("Document not available on server.");
  } catch (e) {
    console.error("[Resume Stream Error]", e);
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

