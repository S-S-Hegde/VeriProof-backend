/**
 * resumeIntelligenceService.js
 *
 * AI-powered resume intelligence using Google Gemini directly from Node.js.
 * No Python engine required for Gemini extraction — but proxies to Python
 * /api/extract-claims-pdf for the full structured claim extraction.
 *
 * Pipeline:
 *  1. Immediately mark ResumeAnalysis as "Parsing" (progress: 15)
 *  2. Call Python /api/extract-claims-pdf — saves full claim objects
 *  3. Persist complete claims (claim_id, skill, context, source_quote)
 *  4. Update progress stages live throughout
 *  5. After success, fire GitHub analysis (non-blocking) if githubUsername exists
 */

const axios = require("axios");
const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ── Gemini setup ───────────────────────────────────────────────────────────────
const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const getModel = () =>
  geminiClient?.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  });

// ── Local text extraction (PDF / DOCX fallback) ────────────────────────────────
const extractTextLocally = async (buffer, mimeType) => {
  if (mimeType === "application/pdf") {
    const pdfData = await pdfParse(buffer);
    return pdfData.text;
  }
  return buffer.toString("utf8");
};

// ── Local keyword dictionary (fallback when Python engine is unavailable) ──────
const SKILL_DICT = [
  ["JavaScript",       "javascript", "js", "ecmascript", "es6"],
  ["TypeScript",       "typescript", "ts"],
  ["Python",           "python"],
  ["Java",             "java", "spring boot", "spring"],
  ["C++",              "c++", "cpp"],
  ["C#",               "c#", "csharp", ".net"],
  ["Go",               "golang"],
  ["Rust",             "rust"],
  ["Ruby",             "ruby", "rails"],
  ["PHP",              "php", "laravel"],
  ["Swift",            "swift"],
  ["Kotlin",           "kotlin"],
  ["SQL",              "sql", "plsql"],
  ["Dart",             "dart", "flutter"],
  ["HTML/CSS",         "html", "css", "sass", "scss"],
  ["React",            "react", "reactjs"],
  ["Next.js",          "next.js", "nextjs"],
  ["Vue.js",           "vue", "vuejs"],
  ["Angular",          "angular"],
  ["Svelte",           "svelte"],
  ["Tailwind CSS",     "tailwind"],
  ["Redux",            "redux", "zustand", "mobx"],
  ["GraphQL",          "graphql", "apollo"],
  ["WebSockets",       "websocket", "socket.io"],
  ["Node.js",          "node.js", "nodejs"],
  ["Express",          "express"],
  ["FastAPI",          "fastapi"],
  ["Django",           "django"],
  ["Flask",            "flask"],
  ["REST API",         "rest api", "restful", "crud"],
  ["Microservices",    "microservices"],
  ["MongoDB",          "mongodb", "mongo"],
  ["PostgreSQL",       "postgresql", "postgres"],
  ["MySQL",            "mysql"],
  ["Redis",            "redis"],
  ["Firebase",         "firebase", "firestore"],
  ["Elasticsearch",    "elasticsearch"],
  ["Git/GitHub",       "git", "github", "gitlab"],
  ["Docker",           "docker", "dockerfile"],
  ["Kubernetes",       "kubernetes", "k8s"],
  ["CI/CD",            "ci/cd", "github actions", "jenkins"],
  ["AWS",              "aws", "ec2", "s3", "lambda"],
  ["GCP",              "gcp", "google cloud"],
  ["Azure",            "azure"],
  ["Linux",            "linux", "bash", "shell"],
  ["Machine Learning", "machine learning", "ml"],
  ["Deep Learning",    "deep learning", "neural network"],
  ["TensorFlow",       "tensorflow", "keras"],
  ["PyTorch",          "pytorch"],
  ["scikit-learn",     "scikit-learn", "sklearn"],
  ["Data Analysis",    "pandas", "numpy", "data analysis"],
  ["LLMs",             "llm", "openai", "gemini", "hugging face"],
  ["NLP",              "nlp", "natural language processing"],
  ["Authentication",   "jwt", "oauth", "bcrypt"],
  ["Security",         "cybersecurity", "owasp", "penetration testing"],
  ["Testing",          "unit testing", "tdd", "jest", "pytest"],
  ["Agile",            "agile", "scrum", "kanban"],
  ["React Native",     "react native"],
  ["Flutter",          "flutter"],
  ["System Design",    "system design", "hld", "lld"],
  ["Full Stack",       "full stack", "fullstack", "mern"],
  ["Figma",            "figma"],
  ["Stripe",           "stripe"],
];

const extractSkillsLocally = (text) => {
  const lower = ` ${text.toLowerCase()} `;
  const found = [];
  for (const [displayName, ...triggers] of SKILL_DICT) {
    for (const trigger of triggers) {
      const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`[^a-z0-9]${escaped}[^a-z0-9]`, "i").test(lower)) {
        found.push(displayName);
        break;
      }
    }
  }
  return [...new Set(found)];
};

// ── Alignment scorer (local, instant) ─────────────────────────────────────────
const scoreAlignmentLocally = (resumeSkills = [], jobRequirements = []) => {
  if (!jobRequirements.length) return 0;
  const normalizedResumeSkills = resumeSkills
    .map(s => (typeof s === "string" ? s : s.skill || ""))
    .filter(Boolean);
  const resumeSet = new Set(normalizedResumeSkills.map(s => s.toLowerCase()));
  const matched = jobRequirements.filter(r => typeof r === "string" && resumeSet.has(r.toLowerCase()));
  return Math.round((matched.length / jobRequirements.length) * 100);
};

// ── Python Engine client ──────────────────────────────────────────────────────
const { aiEngineClient } = require("./aiEngineService");
const FormData = require("form-data");

/**
 * analyzeResumeBuffer — low-level extraction function.
 * Returns { normalizedText, claims: { skills: [] }, analysis: {} }
 */
const analyzeResumeBuffer = async (buffer, options = {}) => {
  let source = "python_microservice";
  let skills = [];
  let meta = {};
  let text = "";

  try {
    // Attempt Python AI Engine parsing
    const formData = new FormData();
    formData.append("file", buffer, {
      filename: options.originalFileName || options.fileName || "resume.pdf",
      contentType: options.mimeType || "application/pdf",
    });

    const aiResult = await aiEngineClient.post("/api/extract-claims-pdf", formData, {
      headers: {
        // Include auth key but let form-data set Content-Type (with boundary)
        "x-internal-api-key": process.env.INTERNAL_API_KEY || "veriproof-dev-secret",
        ...formData.getHeaders(),
      },
    });

    const parsedData = aiResult.data.result;

    // Full claim objects with claim_id, skill, context, source_quote
    skills = parsedData.claims ? parsedData.claims : [];
    meta = { fullClaimsData: parsedData.claims };
    text = parsedData.extracted_text_preview || await extractTextLocally(buffer, options.mimeType);
    console.log(`[Intelligence] Python Engine extracted ${skills.length} claims`);
  } catch (err) {
    console.warn(`[Intelligence] Python Engine failed (${err.message}) — using local keyword fallback`);
    text = await extractTextLocally(buffer, options.mimeType);
    const skillNames = extractSkillsLocally(text);
    // Create synthetic claim objects matching the schema
    skills = skillNames.map((name, i) => ({
      claim_id: `local_${i + 1}`,
      skill: name,
      context: "Extracted by local keyword matcher",
      source_quote: "",
    }));
    source = "local";
    console.log(`[Intelligence] Local extraction: ${skills.length} skills`);
  }

  return {
    normalizedText: text,
    claims: { skills },
    analysis: { ...meta, extractionSource: source },
  };
};

// ── Models & services ─────────────────────────────────────────────────────────
const ResumeAnalysis = require("../models/ResumeAnalysis");
const User = require("../models/User");
const { rebuildSkillProgression } = require("./skillProgressionService");

/**
 * setProgress — utility to update ResumeAnalysis progress live.
 */
const setProgress = async (userId, status, progress, stage) => {
  await ResumeAnalysis.findOneAndUpdate(
    { candidateId: userId },
    { status, progress, stage },
    { upsert: true }
  );
};

/**
 * runAnalysis — main orchestration function.
 * Triggered asynchronously after resume file upload.
 * Saves full claim objects and fires GitHub analysis on completion.
 */
const runAnalysis = async (userId, fileUrl, options) => {
  try {
    // ── Stage 1: Parsing PDF ────────────────────────────────────────────────
    await setProgress(userId, "Parsing", 15, "Parsing PDF document...");

    let buffer;
    if (fileUrl.startsWith("http")) {
      const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
      buffer = Buffer.from(response.data);
    } else {
      const fs = require("fs");
      const path = require("path");
      const relativeUrl = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
      buffer = fs.readFileSync(path.join(__dirname, "..", relativeUrl));
    }

    // ── Stage 2: Extracting Claims ──────────────────────────────────────────
    await setProgress(userId, "Extracting Information", 35, "Running AI claim extraction...");

    const result = await analyzeResumeBuffer(buffer, options);

    // ── Stage 3: Resume Verification ───────────────────────────────────────
    await setProgress(userId, "Parsing", 60, "Verifying extracted claims...");

    // Map full claim objects into the ResumeAnalysis schema
    // Python returns: { claim_id, skill, context, source_quote }
    const mappedSkills = result.claims.skills.map((claim) => ({
      id:                 claim.claim_id || claim.skill?.toLowerCase().replace(/[^a-z0-9]/g, "-") || `c_${Date.now()}`,
      name:               claim.skill || claim.name || "",
      source:             "Resume",
      verificationStatus: "Pending",
      evidenceCount:      0,
      context:            claim.context || "",
      sourceQuote:        claim.source_quote || "",
    }));

    // ── Stage 4: Updating Skill Tree ────────────────────────────────────────
    await setProgress(userId, "Updating Skill Tree", 80, "Updating verified skill tree...");

    // Persist the complete analysis
    await ResumeAnalysis.findOneAndUpdate(
      { candidateId: userId },
      {
        candidateId:       userId,
        resumeUrl:         fileUrl,
        originalFileName:  options.originalFileName,
        mimeType:          options.mimeType,
        status:            "Analysis Complete",
        progress:          100,
        stage:             "Ready",
        estimatedRemainingStage: "Complete",
        active:            true,
        truncatedText:     result.normalizedText?.substring(0, 2000) || "",
        "claims.skills":   mappedSkills,
        analysis: {
          extractionSource:    result.analysis.extractionSource,
          parsingConfidence:   mappedSkills.length > 0 ? 85 : 50,
          resumeCompleteness:  Math.min(100, mappedSkills.length * 5),
          parseErrors:         [],
          missingFields:       [],
        },
        processedAt: new Date(),
        error: "",
      },
      { upsert: true, new: true }
    );

    // ── Stage 5: Mark user as Analyzed and advance pipelineStage ───────────
    const user = await User.findById(userId);
    if (user) {
      user.resumeStatus = "Analyzed";
      
      // Advance pipeline stage for candidates
      if (["resume_upload", "resume_analysis"].includes(user.pipelineStage)) {
        user.pipelineStage = "repository_analysis";
      }

      await user.save();
    }

    // Rebuild skill progression from resume evidence
    try {
      await rebuildSkillProgression(userId);
    } catch (e) {
      console.warn("[Resume Intelligence] Skill progression rebuild failed:", e.message);
    }

    console.log(`[Resume Intelligence] Analysis complete for user ${userId}. ${mappedSkills.length} claims saved.`);

    // ── Stage 6: Fire GitHub Analysis (non-blocking) ────────────────────────
    if (user?.githubUsername) {
      console.log(`[Resume Intelligence] Triggering GitHub analysis for @${user.githubUsername}`);
      const { runGitHubAnalysis } = require("./githubIntelligenceService");
      runGitHubAnalysis(userId).catch((err) => {
        console.error("[GitHub Intelligence] Background analysis error:", err.message);
      });
    } else {
      console.log(`[Resume Intelligence] No GitHub username — skipping repo analysis.`);
    }
  } catch (err) {
    console.error("[Resume Intelligence] runAnalysis failed:", err);
    await ResumeAnalysis.findOneAndUpdate(
      { candidateId: userId },
      {
        status:  "Analysis Failed",
        progress: 0,
        stage:   "Analysis Failed",
        error:   err.message || "Unknown error",
      },
      { upsert: true }
    );
  }
};

module.exports = {
  analyzeResumeBuffer,
  extractSkillsLocally,
  scoreAlignmentLocally,
  runAnalysis,
};
