const PDFDocument = require("pdfkit");
const User    = require("../models/User");
const Project = require("../models/Project");

/* ── Helpers ────────────────────────────────────────────── */
const ORANGE = "#f97316";
const GRAY   = "#6b7280";
const BLACK  = "#0d0d0d";
const LINE   = "#1f1f1f";

function sectionTitle(doc, text, y) {
  doc.moveTo(50, y).lineTo(545, y).strokeColor(ORANGE).lineWidth(0.5).stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(ORANGE)
    .text(text.toUpperCase(), 50, y + 6, { characterSpacing: 2 });
  return y + 24;
}

function bodyText(doc, text, x, y, opts = {}) {
  doc.font("Helvetica").fontSize(9).fillColor(GRAY).text(text, x, y, opts);
}

function boldText(doc, text, x, y, opts = {}) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor(BLACK).text(text, x, y, opts);
}

/* ── Main Generator ─────────────────────────────────────── */
// @desc    Generate and stream a PDF resume
// @route   POST /api/users/resume/generate
// @access  Private
const generateResumePDF = async (req, res) => {
  try {
    const user     = await User.findById(req.user._id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const projects = await Project.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(6);

    // Merge any extra fields sent in the body (AI Builder form)
    const {
      fullName    = user.name,
      email       = user.email,
      phone       = user.phone       || "",
      location    = user.location    || "",
      website     = user.website     || "",
      linkedin    = user.linkedin    || "",
      github      = user.githubUsername || "",
      skills      = (user.skills || []).join(", "),
      education   = user.college
                      ? `${user.branch ? user.branch + " — " : ""}${user.college}${user.batch ? ", " + user.batch : ""}${user.cgpa ? " | CGPA: " + user.cgpa : ""}`
                      : "",
      experience  = "",
      summary     = user.bio || "",
    } = req.body;

    /* Rankings: combine from user's projects (latest non-empty) */
    const rankMap = { hackerrank: "", leetcode: "", codeforces: "", codechef: "" };
    [...projects].reverse().forEach((p) => {
      if (p.rankings) Object.keys(rankMap).forEach((k) => { if (!rankMap[k] && p.rankings[k]) rankMap[k] = p.rankings[k]; });
    });
    const rankLines = Object.entries(rankMap)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`);

    /* === BUILD PDF ======================================= */
    const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 48, left: 50, right: 50 } });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(fullName || "resume").replace(/\s+/g, "_")}_resume.pdf"`,
    );
    doc.pipe(res);

    /* --- Header block ------------------------------------ */
    doc
      .rect(0, 0, 595, 90)
      .fill("#0a0a0a");

    doc
      .font("Helvetica-Bold")
      .fontSize(22)
      .fillColor("#ffffff")
      .text(fullName || "Resume", 50, 22);

    if (user.role === "student") {
      doc.font("Helvetica").fontSize(9).fillColor(ORANGE).text(
        [user.branch, user.college].filter(Boolean).join(" · ") || "Student",
        50, 48,
      );
    }

    // Contact line
    const contacts = [email, phone, location, website, linkedin ? `linkedin.com/in/${linkedin}` : "", github ? `github.com/${github}` : ""].filter(Boolean);
    doc.font("Helvetica").fontSize(8).fillColor("#9ca3af").text(contacts.join("  ·  "), 50, 64, { width: 490 });

    doc.y = 105;

    /* --- Professional Summary ---------------------------- */
    if (summary) {
      doc.y = sectionTitle(doc, "Professional Summary", doc.y);
      bodyText(doc, summary, 50, doc.y, { width: 495, align: "justify" });
      doc.moveDown(1.2);
    }

    /* --- Skills ------------------------------------------ */
    if (skills) {
      doc.y = sectionTitle(doc, "Technical Skills", doc.y);
      bodyText(doc, skills, 50, doc.y, { width: 495 });
      doc.moveDown(1.2);
    }

    /* --- Education --------------------------------------- */
    if (education) {
      doc.y = sectionTitle(doc, "Education", doc.y);
      boldText(doc, education, 50, doc.y);
      if (user.usn) bodyText(doc, `USN: ${user.usn}`, 50, doc.y + 13);
      doc.moveDown(education && user.usn ? 2 : 1.2);
    }

    /* --- Experience ------------------------------------- */
    if (experience) {
      doc.y = sectionTitle(doc, "Internships & Experience", doc.y);
      bodyText(doc, experience, 50, doc.y, { width: 495 });
      doc.moveDown(1.2);
    }

    /* --- Projects --------------------------------------- */
    if (projects.length > 0) {
      doc.y = sectionTitle(doc, "Projects", doc.y);
      projects.forEach((p, i) => {
        const startY = doc.y;
        boldText(doc, p.title, 50, startY);
        // Verified badge
        if (p.isVerified) {
          doc.font("Helvetica-Bold").fontSize(7).fillColor(ORANGE)
            .text("✓ VERIFIED", 400, startY, { continued: false });
        }
        const techStr = (p.technologies || []).join(", ");
        bodyText(doc, techStr, 50, startY + 12, { width: 495 });
        const desc = p.description?.slice(0, 280) + (p.description?.length > 280 ? "…" : "");
        doc.font("Helvetica").fontSize(8.5).fillColor(GRAY).text(desc, 50, startY + 24, { width: 495 });
        if (p.repositoryUrl) {
          doc.font("Helvetica").fontSize(8).fillColor("#3b82f6").text(`→ ${p.repositoryUrl}`, 50, doc.y + 3, { link: p.repositoryUrl });
        }
        doc.moveDown(1.5);
        // Page break guard
        if (doc.y > 720 && i < projects.length - 1) doc.addPage();
      });
    }

    /* --- Platform Rankings ------------------------------ */
    if (rankLines.length > 0) {
      doc.y = sectionTitle(doc, "Competitive Programming Rankings", doc.y);
      rankLines.forEach((line) => {
        bodyText(doc, `→  ${line}`, 50, doc.y);
        doc.moveDown(0.7);
      });
      doc.moveDown(0.5);
    }

    /* --- Footer ----------------------------------------- */
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor("#374151")
      .text(
        `Generated by VERIPROOF — Skill Proof & Verification Platform  ·  ${new Date().toLocaleDateString("en-IN")}`,
        50,
        doc.page.height - 40,
        { align: "center", width: 495 },
      );

    doc.end();
  } catch (err) {
    console.error("PDF generation error:", err);
    if (!res.headersSent) res.status(500).json({ message: "PDF generation failed", error: err.message });
  }
};

module.exports = { generateResumePDF };
