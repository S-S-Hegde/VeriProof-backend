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

// Activity Tracking for Render Free-Tier Keep-Alive
global.lastClientActivity = Date.now();
const PYTHON_API_BASE = process.env.AI_ENGINE_URL || "https://python-engine-adw8.onrender.com";

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

// Keep-Alive Ping endpoint (Pings backend & Python engine while active users exist)
app.get(["/api/keep-alive", "/keep-alive"], async (req, res) => {
  global.lastClientActivity = Date.now();

  // Async warmup ping to Python AI Engine
  axios.get(`${PYTHON_API_BASE}/health`, { timeout: 4000 }).catch(() => {});

  res.status(200).json({
    status: "active",
    awake: true,
    service: "veriproof-system",
    pythonEngine: "warming",
    lastActivity: global.lastClientActivity,
  });
});

app.post("/api/keep-alive/release", (req, res) => {
  // Candidate / User logged out or closed session
  res.status(200).json({ status: "released" });
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
  } else {
    // Gracefully idle when no sessions exist
  }
}, 3.5 * 60 * 1000);

// Ensure upload directories exist
const path = require("path");
const fs = require("fs");
const uploadDir = path.join(__dirname, "uploads", "recruiter-resumes");
const violationsDir = path.join(__dirname, "uploads", "violations");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(violationsDir)) {
  fs.mkdirSync(violationsDir, { recursive: true });
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
      firstPage.drawText("Official Recruiter Candidate Dossier • Anti-Fraud Security Verified", {
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

// Dynamic fallback route for recruiter resumes with VeriProof Verified header
app.get("/uploads/recruiter-resumes/:filename", async (req, res) => {
  try {
    const filename = req.params.filename;
    const localFilePath = path.join(__dirname, "uploads", "recruiter-resumes", filename);

    // 1. If physical file exists on disk, read buffer, stamp header, and stream
    if (fs.existsSync(localFilePath)) {
      const fileBytes = fs.readFileSync(localFilePath);
      const stampedPdf = await stampVeriproofHeader(fileBytes);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      return res.send(stampedPdf);
    }

    const RecruiterApplicant = require("./models/RecruiterApplicant");
    const applicant = await RecruiterApplicant.findOne({
      $or: [
        { fileUrl: new RegExp(filename.replace(/\.pdf$/i, ""), "i") },
        { fileUrl: `/uploads/recruiter-resumes/${filename}` },
        { originalFileName: new RegExp(filename.replace(/\.pdf$/i, ""), "i") },
      ],
    });

    // 2. If original binary buffer is in database, stamp header and stream original PDF
    if (applicant && applicant.fileBufferBase64) {
      const pdfBuffer = Buffer.from(applicant.fileBufferBase64, "base64");
      const stampedPdf = await stampVeriproofHeader(pdfBuffer);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${applicant.originalFileName || filename}"`
      );
      return res.send(stampedPdf);
    }

    // 3. If only structured resumeText exists (legacy record), generate a clean professional PDF
    if (applicant && applicant.resumeText) {
      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${applicant.extractedName || "Candidate"}_Verified_Resume.pdf"`
      );
      doc.pipe(res);

      // Header Banner
      doc.rect(0, 0, doc.page.width, 50).fill("#0d1226");
      doc.fillColor("#6b8aff").fontSize(15).text("VERIPROOF VERIFIED RESUME", 40, 16);
      doc.fillColor("#94a0b8").fontSize(8).text("Official Recruiter Candidate Dossier • Anti-Fraud Security Verified", 40, 34);

      doc.moveDown(2.5);
      doc.fillColor("#000000").fontSize(14).text(applicant.extractedName || "Verified Candidate", { bold: true });
      if (applicant.extractedEmail) {
        doc.fillColor("#555555").fontSize(9).text(`Email: ${applicant.extractedEmail}`);
      }
      if (applicant.githubUsername) {
        doc.fillColor("#555555").fontSize(9).text(`GitHub: github.com/${applicant.githubUsername}`);
      }
      doc.moveDown(0.8);
      doc.strokeColor("#cccccc").lineWidth(1).moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).stroke();
      doc.moveDown(0.8);

      // Body text
      doc.fillColor("#222222").fontSize(9.5).lineGap(3).text(applicant.resumeText, {
        align: "left",
        width: doc.page.width - 80,
      });

      doc.end();
      return;
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

