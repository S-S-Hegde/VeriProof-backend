/**
 * resumeIntelligenceService.js
 *
 * Self-sufficient resume intelligence pipeline.
 *
 * Strategy:
 *  1. Parse PDF/DOCX to plain text (local — always works)
 *  2. Try to call Python AI engine for skill extraction (best quality)
 *  3. If Python is offline → fall back to local keyword matcher (always available)
 *  4. Score alignment against job requirements locally
 *
 * This means the system works even when the Python service is not running.
 */

const axios  = require("axios");
const pdfParse = require("pdf-parse"); // v1.1.1 — plain async function

const PYTHON_API_BASE = process.env.PYTHON_API_BASE || "http://127.0.0.1:8000/api";
const PYTHON_TIMEOUT  = 12000; // 12 s — don't wait too long before falling back

/* ═══════════════════════════════════════════════════════════════════════
   LOCAL SKILL KEYWORD DICTIONARY
   Covers the most common resume skills that recruiters look for.
   Each entry: [display name, ...trigger keywords (lowercase)]
   ═══════════════════════════════════════════════════════════════════════ */
const SKILL_DICT = [
  // Languages
  ["JavaScript",       "javascript", "js", "ecmascript", "es6", "es2015"],
  ["TypeScript",       "typescript", "ts"],
  ["Python",           "python", "django", "flask", "fastapi"],
  ["Java",             "java", "spring boot", "spring", "maven", "gradle"],
  ["C++",              "c++", "cpp"],
  ["C#",               "c#", "csharp", "dotnet", ".net"],
  ["Go",               "golang", " go "],
  ["Rust",             "rust"],
  ["Ruby",             "ruby", "rails", "ruby on rails"],
  ["PHP",              "php", "laravel", "symfony"],
  ["Swift",            "swift", "ios", "xcode"],
  ["Kotlin",           "kotlin", "android"],
  ["SQL",              "sql", "plsql", "t-sql"],
  ["R",                " r ", "rstudio"],
  ["Scala",            "scala", "spark"],
  ["Dart",             "dart", "flutter"],

  // Frontend
  ["HTML/CSS",         "html", "css", "sass", "scss", "less"],
  ["React",            "react", "reactjs", "react.js", "react native"],
  ["Next.js",          "next.js", "nextjs", "next js"],
  ["Vue.js",           "vue", "vuejs", "vue.js", "nuxt"],
  ["Angular",          "angular", "angularjs"],
  ["Svelte",           "svelte", "sveltekit"],
  ["Tailwind CSS",     "tailwind", "tailwindcss"],
  ["Webpack",          "webpack", "vite", "rollup", "parcel", "esbuild"],
  ["Redux",            "redux", "zustand", "mobx", "recoil"],
  ["GraphQL",          "graphql", "apollo"],
  ["WebSockets",       "websocket", "socket.io", "websockets"],

  // Backend
  ["Node.js",          "node.js", "nodejs", "node js"],
  ["Express",          "express", "expressjs", "express.js"],
  ["FastAPI",          "fastapi"],
  ["Django",           "django"],
  ["Flask",            "flask"],
  ["Spring Boot",      "spring boot"],
  ["REST API",         "rest api", "restful", "rest", "crud"],
  ["gRPC",             "grpc"],
  ["Microservices",    "microservices", "microservice"],
  ["Message Queues",   "rabbitmq", "kafka", "celery", "message queue", "pub/sub"],

  // Databases
  ["MongoDB",          "mongodb", "mongo"],
  ["PostgreSQL",       "postgresql", "postgres"],
  ["MySQL",            "mysql"],
  ["SQLite",           "sqlite"],
  ["Redis",            "redis"],
  ["Elasticsearch",    "elasticsearch", "elastic"],
  ["Firebase",         "firebase", "firestore"],
  ["DynamoDB",         "dynamodb"],
  ["Cassandra",        "cassandra"],
  ["Supabase",         "supabase"],

  // DevOps & Cloud
  ["Git/GitHub",       "git", "github", "gitlab", "bitbucket", "version control"],
  ["Docker",           "docker", "dockerfile", "container", "containerisation"],
  ["Kubernetes",       "kubernetes", "k8s", "helm"],
  ["CI/CD",            "ci/cd", "github actions", "jenkins", "circleci", "travis", "pipeline"],
  ["AWS",              "aws", "amazon web services", "ec2", "s3", "lambda", "rds", "ecs"],
  ["GCP",              "gcp", "google cloud", "bigquery", "cloud run"],
  ["Azure",            "azure", "microsoft azure"],
  ["Terraform",        "terraform", "infrastructure as code", "iac"],
  ["Linux",            "linux", "unix", "bash", "shell scripting", "shell"],
  ["Nginx",            "nginx", "apache"],
  ["Monitoring",       "datadog", "prometheus", "grafana", "newrelic", "sentry"],

  // AI / ML / Data
  ["Machine Learning", "machine learning", "ml", "supervised", "unsupervised"],
  ["Deep Learning",    "deep learning", "neural network", "cnn", "rnn", "lstm"],
  ["TensorFlow",       "tensorflow", "keras"],
  ["PyTorch",          "pytorch"],
  ["scikit-learn",     "scikit-learn", "sklearn"],
  ["Data Analysis",    "pandas", "numpy", "data analysis", "data analytics"],
  ["Data Visualization","matplotlib", "seaborn", "plotly", "tableau", "power bi"],
  ["LLMs",             "llm", "large language model", "openai", "gemini", "claude", "hugging face"],
  ["RAG",              "rag", "retrieval augmented"],
  ["NLP",              "nlp", "natural language processing", "spacy", "nltk"],

  // Security
  ["Authentication",   "jwt", "oauth", "oauth2", "authentication", "authorisation", "authorization", "bcrypt", "saml"],
  ["Security",         "cybersecurity", "owasp", "xss", "csrf", "sql injection", "penetration testing", "pentest"],
  ["API Security",     "rate limiting", "cors", "helmet", "input validation"],

  // Testing
  ["Testing",          "unit testing", "integration testing", "tdd", "test driven", "bdd"],
  ["Jest",             "jest"],
  ["Pytest",           "pytest"],
  ["Cypress",          "cypress"],
  ["Playwright",       "playwright"],
  ["Selenium",         "selenium"],

  // Architecture & Design
  ["System Design",    "system design", "high-level design", "hld", "low-level design", "lld"],
  ["Design Patterns",  "design pattern", "solid", "dry", "mvc", "mvvm", "clean architecture"],
  ["Full Stack",       "full stack", "fullstack", "mern", "mean", "mevn"],
  ["Agile",            "agile", "scrum", "kanban", "sprint", "jira"],

  // Mobile
  ["React Native",     "react native"],
  ["Flutter",          "flutter"],
  ["iOS",              "ios", "swift", "xcode"],
  ["Android",          "android", "kotlin"],

  // Other popular tools
  ["Figma",            "figma"],
  ["Postman",          "postman"],
  ["Cloudinary",       "cloudinary"],
  ["Stripe",           "stripe", "payment gateway"],
  ["Twilio",           "twilio"],
];

/* ═══════════════════════════════════════════════════════════════════════
   LOCAL SKILL EXTRACTOR
   Scans normalised text for keyword matches and returns unique skill names
   ═══════════════════════════════════════════════════════════════════════ */
const extractSkillsLocally = (text) => {
  const lower = ` ${text.toLowerCase()} `;
  const found  = [];

  for (const [displayName, ...triggers] of SKILL_DICT) {
    for (const trigger of triggers) {
      // Word-boundary check: trigger must be surrounded by non-alphanumeric chars
      const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`[^a-z0-9]${escaped}[^a-z0-9]`, "i");
      if (pattern.test(lower)) {
        found.push(displayName);
        break; // only add each skill once
      }
    }
  }

  return [...new Set(found)]; // deduplicate
};

/* ═══════════════════════════════════════════════════════════════════════
   LOCAL ALIGNMENT SCORER
   Returns a 0-100 score: what % of job requirements are found in resume
   ═══════════════════════════════════════════════════════════════════════ */
const scoreAlignmentLocally = (resumeSkills, jobRequirements) => {
  if (!jobRequirements || jobRequirements.length === 0) return 0;
  const resumeSet = new Set(resumeSkills.map(s => s.toLowerCase()));
  const matched = jobRequirements.filter(r => resumeSet.has(r.toLowerCase()));
  return Math.round((matched.length / jobRequirements.length) * 100);
};

/* ═══════════════════════════════════════════════════════════════════════
   MAIN — analyzeResumeBuffer
   ═══════════════════════════════════════════════════════════════════════ */
const analyzeResumeBuffer = async (buffer, options = {}) => {
  // ── Step 1: Extract text ──────────────────────────────────────────────
  let text = "";

  if (options.mimeType === "application/pdf") {
    const pdfData = await pdfParse(buffer);
    text = pdfData.text;
  } else {
    text = buffer.toString("utf8");
  }

  if (!text || text.trim().length === 0) {
    throw new Error("No readable text found in document.");
  }

  // ── Step 2: Skill extraction (Python first, local fallback) ───────────
  let skills  = [];
  let analysis = {};
  let source   = "local";

  try {
    const pythonRes = await axios.post(
      `${PYTHON_API_BASE}/extract-skills`,
      { text },
      { timeout: PYTHON_TIMEOUT },
    );
    skills   = pythonRes.data.result.skills   || [];
    analysis = pythonRes.data.result.analysis || {};
    source   = "python";
    console.log(`[Intelligence] Python extraction: ${skills.length} skills`);
  } catch (err) {
    // Python offline or timed out — use local keyword matcher
    const isConnErr = err.code === "ECONNREFUSED" || err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
    if (isConnErr) {
      console.warn("[Intelligence] Python AI engine offline — using local keyword extractor");
    } else {
      console.warn("[Intelligence] Python AI error:", err.message, "— falling back to local");
    }
    skills = extractSkillsLocally(text);
    analysis = { note: "Extracted via local keyword matcher (Python AI engine offline)" };
    source = "local";
    console.log(`[Intelligence] Local extraction: ${skills.length} skills`);
  }

  return {
    normalizedText: text,
    claims: { skills },
    analysis: { ...analysis, extractionSource: source },
  };
};

/* ═══════════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════════ */
module.exports = {
  analyzeResumeBuffer,
  extractSkillsLocally,
  scoreAlignmentLocally,
};
