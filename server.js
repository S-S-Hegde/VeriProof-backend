const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/db");

// Route files
const authRoutes    = require("./routes/authRoutes");
const projectRoutes = require("./routes/projectRoutes");
const verifyRoutes  = require("./routes/verifyRoutes");
const pdfRoutes     = require("./routes/pdfRoutes");
const examRoutes    = require("./routes/examRoutes");

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.use("/api/resume", pdfRoutes);
app.use("/api/exams", examRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, console.log(`Server running on port ${PORT}`));
