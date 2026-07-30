/**
 * resumeIntelligenceService.js
 *
 * AI-powered resume intelligence using Google Gemini directly from Node.js.
 * No Python engine required.
 *
 * Pipeline:
 *  1. Extract raw text from PDF / DOCX (local, always works)
 *  2. Send text to Gemini 1.5 Flash for structured skill + profile extraction
 *  3. If Gemini fails (rate-limit, quota, etc.) → fall back to local keyword matcher
 *  4. Score alignment between resume skills and job requirements (local, instant)
 */

const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// ── Gemini setup ───────────────────────────────────────────────────────────────
const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const getModel = () =>
  geminiClient?.getGenerativeModel({
    model: "gemini-3.6-flash",          // Custom model available on the current API key
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,                 // Low temp = deterministic, structured output
      maxOutputTokens: 1024,
    },
  });


// ── Gemini prompt ──────────────────────────────────────────────────────────────
const buildExtractionPrompt = (text, strictMode = false) => `
You are an expert technical recruiter and resume analyst.
Analyse the resume text below and return a valid JSON object with these exact fields:

{
  "name": "Candidate's full name (string, or null if not found)",
  "email": "Email address (string, or null if not found)",
  "skills": ["Array of technical and professional skills mentioned"],
  "experience_years": "Total years of experience as a number (or 0 if unclear)",
  "education": "Highest degree or qualification (string)",
  "summary": "One sentence professional summary"
}

Rules:
- Return ONLY the JSON object. No markdown, no code fences, no explanation.
- Skills must be specific technologies, tools, frameworks, or methodologies.
- Include both technical and soft skills only if clearly stated.
- Keep skill names concise (e.g. "React" not "React.js framework for building UIs").
${strictMode ? `
- STRICT MODE ENABLED: Only include skills that the candidate has applied in actual job positions, internships, or complete projects. Do NOT include skills that are merely listed under "Interests", "Acquiring", "Familiar with", or "Exposure to". We need only verified expertise skills to prevent keyword stuffing or false positives.` : ""}

Resume text:
---
${text.substring(0, 12000)}
---
`;


// ── Local keyword dictionary (fallback) ────────────────────────────────────────
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
  const resumeSet = new Set(resumeSkills.map(s => s.toLowerCase()));
  const matched = jobRequirements.filter(r => resumeSet.has(r.toLowerCase()));
  return Math.round((matched.length / jobRequirements.length) * 100);
};

// ── Gemini extraction ──────────────────────────────────────────────────────────
const extractWithGemini = async (text, strictMode = false) => {
  const model = getModel();
  if (!model) throw new Error("GEMINI_API_KEY not configured");

  const prompt = buildExtractionPrompt(text, strictMode);
  const result = await model.generateContent(prompt);
  const raw    = result.response.text().trim();

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed  = JSON.parse(cleaned);

  return {
    name:             parsed.name             || null,
    email:            parsed.email            || null,
    skills:           Array.isArray(parsed.skills) ? parsed.skills : [],
    experience_years: parsed.experience_years || 0,
    education:        parsed.education        || "",
    summary:          parsed.summary          || "",
  };
};

// ── Main export ────────────────────────────────────────────────────────────────
const analyzeResumeBuffer = async (buffer, options = {}) => {
  // Step 1: Extract text (local — always works)
  let text = "";
  if (options.mimeType === "application/pdf") {
    const pdfData = await pdfParse(buffer);
    text = pdfData.text;
  } else {
    text = buffer.toString("utf8");
  }

  if (!text || text.trim().length < 20) {
    throw new Error("No readable text found in document.");
  }

  // Step 2: Gemini AI extraction (with local fallback)
  let skills   = [];
  let meta     = {};
  let source   = "local";

  try {
    const aiResult = await extractWithGemini(text, options.strictMode);
    skills  = aiResult.skills;
    meta    = {
      name:             aiResult.name,
      email:            aiResult.email,
      experience_years: aiResult.experience_years,
      education:        aiResult.education,
      summary:          aiResult.summary,
    };

    source  = "gemini";
    console.log(`[Intelligence] Gemini extracted ${skills.length} skills for "${aiResult.name || "unknown"}"`);
  } catch (err) {
    console.warn(`[Intelligence] Gemini failed (${err.message}) — using local keyword extractor`);
    skills = extractSkillsLocally(text);
    source = "local";
    console.log(`[Intelligence] Local extraction: ${skills.length} skills`);
  }

  return {
    normalizedText: text,
    claims: { skills },
    analysis: {
      ...meta,
      extractionSource: source,
    },
  };
};

module.exports = {
  analyzeResumeBuffer,
  extractSkillsLocally,
  scoreAlignmentLocally,
};
