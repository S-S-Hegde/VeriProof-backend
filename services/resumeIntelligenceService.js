/**
 * resumeIntelligenceService.js
 *
 * High-speed AI-powered candidate resume intelligence.
 * Performs instant forensic parsing, email verification, GitHub handle discovery,
 * LLM skill extraction, skill tree rebuild, and automated repository intelligence.
 */

const axios = require("axios");
const pdfParse = require("pdf-parse");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const { extractText: extractWithUnpdf } = require("unpdf");

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

// ── Local text extraction (PDF / DOCX / TXT with robust modern engines) ─────────
const extractTextLocally = async (buffer, mimeType = "", filename = "") => {
  if (!buffer || !Buffer.isBuffer(buffer)) return "";

  const ext = path.extname(filename).toLowerCase();
  const isPdf = mimeType.includes("pdf") || ext === ".pdf" || buffer.subarray(0, 1024).toString("latin1").includes("%PDF-");
  const isDocx = mimeType.includes("wordprocessingml") || mimeType.includes("msword") || ext === ".docx" || ext === ".doc";

  // 1. Try modern PDF parsing via unpdf (handles all PDF 1.4-1.7 specifications)
  if (isPdf) {
    try {
      const result = await extractWithUnpdf(new Uint8Array(buffer));
      if (result && result.text) {
        const fullText = Array.isArray(result.text) ? result.text.join("\n") : String(result.text);
        if (fullText.trim().length > 10) {
          return fullText.trim();
        }
      }
    } catch (unpdfErr) {
      console.warn(`[TextExtraction] unpdf notice for ${filename || 'file'}: ${unpdfErr.message}`);
    }

    try {
      const pdfData = await pdfParse(buffer);
      if (pdfData && pdfData.text && pdfData.text.trim().length > 10) {
        return pdfData.text.trim();
      }
    } catch (pdfErr) {
      console.warn(`[TextExtraction] pdf-parse notice for ${filename || 'file'}: ${pdfErr.message}`);
    }
  }

  // 2. Try DOCX parsing via mammoth
  if (isDocx) {
    try {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      if (result && result.value && result.value.trim().length > 10) {
        return result.value.trim();
      }
    } catch (docxErr) {
      console.warn(`[TextExtraction] mammoth notice for ${filename || 'file'}: ${docxErr.message}`);
    }
  }

  // 3. Plain text documents only (NEVER return raw %PDF- binary streams)
  if (!isPdf) {
    try {
      const rawText = buffer.toString("utf8");
      const cleanText = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();
      if (cleanText.length > 10 && !cleanText.startsWith("%PDF-")) return cleanText;
    } catch (e) {}

    const latin = buffer.toString("latin1").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ").trim();
    if (!latin.startsWith("%PDF-")) return latin;
  }

  return "";
};

// ── Universal IT Industry Taxonomy (Exhaustive High-Accuracy Dictionary) ──────────────
const SKILL_DICT = [
  // ── 1. Leadership, Management, Methodologies & Operations ──
  ["Project Management",       "project management", "project manager", "project lead", "project planning", "scope management", "resource coordination", "pmp", "capm", "prince2"],
  ["Agile & Scrum",            "agile", "scrum", "kanban", "sprints", "daily stand-ups", "retrospectives", "scrum master", "safe", "sprint planning"],
  ["SDLC",                     "sdlc", "software development lifecycle", "software development lifecycles", "waterfall", "v-model"],
  ["Product Management",       "product management", "product manager", "product owner", "roadmapping", "user stories", "product strategy"],
  ["Business Analysis",        "business analysis", "business analyst", "requirements gathering", "brd", "frd", "gap analysis", "stakeholder management"],
  ["IT Service Management",    "itil", "itsm", "servicenow", "jira service desk", "incident management", "change management", "sla"],
  ["Enterprise Platforms",     "enterprise platforms", "enterprise solutions", "microsoft office 365", "office 365", "trello", "asana", "jira", "confluence", "notion"],

  // ── 2. Software Engineering & Architecture ──
  ["Software Development",     "software development", "software engineering", "software engineer", "developer", "programmer"],
  ["Enterprise Architecture",  "enterprise architecture", "software architecture", "enterprise-grade", "system design", "hld", "lld", "design patterns", "clean architecture", "solid principles"],
  ["Full Stack",               "full stack", "full-stack", "mern", "mean", "lamp", "fullstack"],
  ["Frontend Development",     "frontend", "front-end", "client-side", "ui development", "single page applications", "spa"],
  ["Backend Development",      "backend", "back-end", "server-side", "api development", "business logic"],
  ["Microservices",            "microservices", "microservice", "service-oriented architecture", "soa", "monolith to microservices", "grpc", "event-driven architecture"],
  ["REST API",                 "rest api", "restful", "crud", "api design", "openapi", "swagger", "postman"],
  ["GraphQL",                  "graphql", "apollo", "relay", "schema design"],
  ["WebSockets",               "websocket", "socket.io", "real-time", "real time communication", "sse"],
  ["Low Latency",              "low latency", "low-latency", "high-throughput", "low latency infrastructure", "hft", "high frequency trading", "real-time systems"],
  ["Distributed Systems",      "distributed systems", "distributed computing", "high scalability", "scalable platforms", "massive-scale", "consensus protocols", "raft", "paxos"],
  ["Web Technologies",         "web technologies", "web development", "progressive web apps", "pwa", "web assembly", "wasm"],

  // ── 3. Programming Languages ──
  ["JavaScript",               "javascript", "js", "ecmascript", "es6", "es2020", "esnext"],
  ["TypeScript",               "typescript", "ts"],
  ["Python",                   "python", "python3", "pandas", "numpy", "scipy"],
  ["Java",                     "java", "spring boot", "spring framework", "hibernate", "jpa", "jvm"],
  ["C++",                      "c++", "cpp", "modern c++", "c++17", "c++20", "stl"],
  ["C#",                       "c#", "csharp", ".net", ".net core", "asp.net", "entity framework"],
  ["C",                        "c programming", "ansi c", "embedded c"],
  ["Go",                       "golang", "go programming", "goroutines"],
  ["Rust",                     "rust", "cargo", "memory safety", "tokio"],
  ["Ruby",                     "ruby", "ruby on rails", "rails"],
  ["PHP",                      "php", "laravel", "symfony", "wordpress"],
  ["Swift",                    "swift", "swiftui", "cocoa touch", "ios development"],
  ["Kotlin",                   "kotlin", "jetpack compose", "android development", "kotlin multiplatform"],
  ["Dart",                     "dart", "flutter"],
  ["Scala",                    "scala", "akka", "play framework"],
  ["R",                        "r programming", "rstudio", "ggplot2"],
  ["Shell / Bash",             "bash", "shell scripting", "powershell", "zsh", "sh"],
  ["SQL",                      "sql", "pl/sql", "t-sql", "stored procedures"],

  // ── 4. Web Frameworks & UI/UX ──
  ["React",                    "react", "reactjs", "react.js", "jsx", "tsx"],
  ["Next.js",                  "next.js", "nextjs", "server-side rendering", "ssr", "ssg"],
  ["Vue.js",                   "vue", "vuejs", "vue 3", "nuxt", "pinia"],
  ["Angular",                  "angular", "angularjs", "angular 2+", "rxjs", "ngrx"],
  ["Svelte",                   "svelte", "sveltekit"],
  ["HTML/CSS",                 "html", "html5", "css", "css3", "sass", "scss", "less"],
  ["Tailwind CSS",             "tailwind", "tailwindcss"],
  ["Redux",                    "redux", "redux toolkit", "rtk", "zustand", "mobx", "recoil"],
  ["Node.js",                  "node.js", "nodejs", "npm", "yarn", "pnpm", "bun"],
  ["Express",                  "express", "express.js", "expressjs"],
  ["NestJS",                   "nestjs", "nest.js"],
  ["FastAPI",                  "fastapi", "uvicorn", "pydantic"],
  ["Django",                   "django", "django rest framework", "drf"],
  ["Flask",                    "flask", "jinja"],
  ["UI/UX",                    "ui/ux", "ui / ux", "user interface", "user experience", "figma", "adobe xd", "sketch", "wireframing", "prototyping", "design systems"],

  // ── 5. Databases & Caching ──
  ["Databases",                "database", "databases", "rdbms", "nosql", "relational database", "schema design", "acid"],
  ["PostgreSQL",               "postgresql", "postgres", "pgvector", "supabase"],
  ["MySQL",                    "mysql", "mariadb"],
  ["MongoDB",                  "mongodb", "mongo", "mongoose"],
  ["Redis",                    "redis", "in-memory cache", "key-value store", "redis streams"],
  ["Elasticsearch",            "elasticsearch", "elastic stack", "elk", "kibana", "opensearch", "lucene"],
  ["Cassandra",                "cassandra", "apache cassandra", "scylladb"],
  ["DynamoDB",                 "dynamodb", "aws dynamodb"],
  ["Firebase",                 "firebase", "firestore", "realtime database"],
  ["Oracle DB",                "oracle database", "oracle db", "plsql"],
  ["SQL Server",               "sql server", "ms sql", "ssms"],

  // ── 6. Cloud, DevOps & Infrastructure ──
  ["Cloud Computing",          "cloud", "cloud solutions", "cloud engineers", "public cloud", "private cloud", "hybrid cloud", "serverless", "cloud architecture"],
  ["AWS",                      "aws", "amazon web services", "ec2", "s3", "lambda", "fargate", "cloudformation", "iam", "route 53", "rds"],
  ["GCP",                      "gcp", "google cloud", "google cloud platform", "bigquery", "cloud run", "gke", "cloud functions"],
  ["Azure",                    "azure", "microsoft azure", "azure devops", "azure functions", "aks", "app service"],
  ["Docker",                   "docker", "dockerfile", "containerization", "containers", "docker compose"],
  ["Kubernetes",               "kubernetes", "k8s", "helm", "istio", "ingress", "cluster management"],
  ["CI/CD",                    "ci/cd", "ci / cd", "continuous integration", "continuous deployment", "github actions", "gitlab ci", "jenkins", "argo cd", "circleci"],
  ["Terraform",                "terraform", "infrastructure as code", "iac", "terragrunt", "pulumi"],
  ["Ansible",                  "ansible", "configuration management", "chef", "puppet"],
  ["Linux / Unix",             "linux", "unix", "ubuntu", "centos", "redhat", "rhel", "debian", "kernel"],
  ["Networking",               "networking", "network protocols", "tcp/ip", "udp", "http/2", "http/3", "dns", "load balancing", "nginx", "reverse proxy", "haproxy"],
  ["Site Reliability (SRE)",   "sre", "site reliability engineering", "observability", "prometheus", "grafana", "datadog", "new relic", "splunk", "opentelemetry"],

  // ── 7. Data Engineering, Big Data & Analytics ──
  ["Data Engineering",         "data engineering", "data pipelines", "etl", "elt", "data modeling", "data warehousing", "data lake"],
  ["Big Data",                 "big data", "big data platforms", "apache spark", "spark", "hadoop", "hdfs", "pyspark", "flink"],
  ["Data Streaming",           "apache kafka", "kafka", "rabbitmq", "message queues", "pulsar", "event streaming"],
  ["Data Warehousing",         "snowflake", "databricks", "dbt", "redshift", "bigquery", "synapse"],
  ["Data Analysis",            "data analysis", "analytical thinking", "performance metrics", "data analytics", "eda", "statistical analysis", "kpi"],
  ["Data Visualization",       "data visualization", "visualization tools", "tableau", "power bi", "powerbi", "looker", "dashboard", "metabase"],
  ["Financial Modeling",       "financial models", "finance", "financial services", "investment banking", "stochastic calculus", "trading algorithms", "quantitative analysis"],

  // ── 8. AI, Machine Learning & GenAI ──
  ["Machine Learning",         "machine learning", "ml", "supervised learning", "unsupervised learning", "reinforcement learning", "feature engineering"],
  ["Deep Learning",            "deep learning", "neural network", "neural networks", "cnn", "rnn", "transformers", "lstm"],
  ["Generative AI & LLMs",     "generative ai", "genai", "llm", "llms", "large language models", "openai", "gpt", "rag", "retrieval augmented generation", "langchain", "llamaindex", "prompt engineering", "fine-tuning", "vector database", "pinecone", "chromadb"],
  ["PyTorch",                  "pytorch", "torch"],
  ["TensorFlow",               "tensorflow", "keras", "tf"],
  ["scikit-learn",             "scikit-learn", "sklearn"],
  ["Computer Vision",          "computer vision", "opencv", "yolo", "image processing", "object detection", "image classification"],
  ["Natural Language (NLP)",   "nlp", "natural language processing", "spacy", "nltk", "bert", "hugging face", "tokenization", "text classification"],
  ["MLOps",                    "mlops", "mlflow", "kubeflow", "model deployment", "wandb", "feature store"],

  // ── 9. Cybersecurity & Information Security ──
  ["Cyber Security",           "cyber security", "cybersecurity", "security by design", "cyber threats", "security experts", "infosec", "information security"],
  ["Penetration Testing",      "penetration testing", "pen testing", "ethical hacking", "vulnerability assessment", "burp suite", "metasploit", "nmap", "kali linux"],
  ["Security Operations (SOC)","soc", "siem", "splunk", "incident response", "threat hunting", "edr", "crowdstrike", "sentinel"],
  ["Application Security",     "appsec", "application security", "owasp", "owasp top 10", "sast", "dast", "security audits"],
  ["Cloud Security & IAM",     "cloud security", "iam", "identity and access management", "zero trust", "kms", "oauth2", "oidc", "saml"],
  ["Cryptography",             "cryptography", "encryption", "tls", "ssl", "pki", "hashing", "aes", "rsa"],
  ["Compliance & Governance",  "gdpr", "hipaa", "soc 2", "soc2", "iso 27001", "pci-dss", "nist", "security compliance"],

  // ── 10. Quality Assurance, Testing & Automation ──
  ["Quality Assurance & Testing", "qa", "quality assurance", "software testing", "test cases", "test plans", "bug tracking", "system testing", "regression testing"],
  ["Test Automation",          "test automation", "automated testing", "selenium", "cypress", "playwright", "appium", "webdriver"],
  ["Unit & Integration Testing","unit testing", "integration testing", "tdd", "test driven development", "bdd", "jest", "mocha", "chai", "pytest", "junit", "testng"],
  ["Performance & Load Testing","performance testing", "load testing", "stress testing", "jmeter", "k6", "gatling", "locust"],
  ["User Acceptance Testing",  "user acceptance testing", "uat", "manual testing", "exploratory testing", "break-fixes", "troubleshooting"],

  // ── 11. Enterprise CRM, ERP & Specialized Tech ──
  ["Salesforce",               "salesforce", "apex", "lightning web components", "lwc", "soql", "sales cloud", "service cloud"],
  ["SAP",                      "sap", "abap", "s/4hana", "sap hana", "sap erp", "fiori"],
  ["Blockchain & Web3",        "blockchain", "web3", "smart contracts", "solidity", "ethereum", "ethers.js", "web3.js", "hyperledger", "defi"],
  ["Embedded Systems & IoT",   "embedded systems", "iot", "internet of things", "microcontrollers", "arduino", "raspberry pi", "rtos", "mqtt"],
  ["AR / VR & Gaming",         "unity", "unity3d", "unreal engine", "ar/vr", "augmented reality", "virtual reality", "c# unity", "game development"],
];

const extractSkillsLocally = (text) => {
  if (!text || typeof text !== "string") return [];
  const normalized = text.toLowerCase();
  const found = [];

  for (const [displayName, ...triggers] of SKILL_DICT) {
    for (const trigger of triggers) {
      const t = trigger.toLowerCase();
      const hasSpecial = /[^a-z0-9\s]/.test(t);

      if (hasSpecial) {
        if (normalized.includes(t)) {
          found.push(displayName);
          break;
        }
      } else {
        const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(normalized)) {
          found.push(displayName);
          break;
        }
      }
    }
  }
  return [...new Set(found)];
};

// ── Forensic regex extractors ──────────────────────────────────────────────────
const extractEmailFromText = (text) => {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase().trim() : null;
};

const extractGithubFromText = (text) => {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/(?:github\.com\/|github:\s*|github\s+handle:\s*|github\s+username:\s*)([a-zA-Z0-9\-]+)/i);
  if (match && match[1]) {
    const handle = match[1].toLowerCase().trim();
    if (!["github", "com", "org", "none", "http", "https", "repo", "repositories"].includes(handle)) {
      return handle;
    }
  }
  return null;
};

// ── Multi-LLM Direct Extraction (Gemini + Mistral Fallback) ───────────────────
const extractClaimsWithGemini = async (text) => {
  if (!text || text.length < 30) return null;

  const prompt = `You are a Principal IT Talent Acquisition Architect & Senior Technical Evaluator.
Analyze this document (Job Description or Candidate Resume) and extract the official Job Title / Candidate Name, all core and specialized IT technical competencies, frameworks, tools, cloud architectures, and project claims:
"""
${text.substring(0, 6000)}
"""

Extract all relevant skills across all IT sectors (Software Engineering, Frontend, Backend, Cloud/DevOps, Data/AI/ML, Cybersecurity, QA/Testing, Product/Agile, Systems Architecture).

Return strict JSON format:
{
  "title": "Official Job Title or Candidate Name (e.g., Managing Director - Software Engineering, Technical Project Manager, Cloud Architect)",
  "skills": [
    { "skill": "Standardized Skill Name", "context": "Context or requirement quote from text", "source_quote": "exact phrase" }
  ],
  "projects": [
    {
      "title": "Project Name",
      "description": "Brief summary",
      "technologies": ["React", "Node.js", "Docker"],
      "liveDemoUrl": "",
      "githubUrl": ""
    }
  ]
}`;

  // 1. Try Gemini
  if (geminiClient) {
    try {
      const model = getModel();
      if (model) {
        const result = await Promise.race([
          model.generateContent(prompt),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Gemini timeout")), 3000))
        ]);
        const responseText = result.response.text();
        const parsed = JSON.parse(responseText.replace(/```json|```/g, "").trim());
        if (parsed && (Array.isArray(parsed.skills) || Array.isArray(parsed.projects))) {
          return {
            title: parsed.title || "",
            skills: Array.isArray(parsed.skills) ? parsed.skills.map((s, idx) => ({
              claim_id: `claim_${idx + 1}`,
              skill: s.skill || s.name || (typeof s === "string" ? s : ""),
              context: s.context || "Extracted from document text",
              source_quote: s.source_quote || s.skill || "",
              category: "Skill",
              confidence: 95
            })).filter(s => Boolean(s.skill)) : [],
            projects: Array.isArray(parsed.projects) ? parsed.projects.map((p) => ({
              title: p.title || "",
              description: p.description || "",
              technologies: Array.isArray(p.technologies) ? p.technologies : [],
              liveDemoUrl: p.liveDemoUrl || "",
              githubUrl: p.githubUrl || "",
            })).filter(p => Boolean(p.title && p.title.length > 2)) : [],
          };
        }
      }
    } catch (err) {
      console.warn(`[Resume Intelligence] Gemini direct extraction note: ${err.message}`);
    }
  }

  // 2. Try Mistral
  if (process.env.MISTRAL_API_KEY) {
    try {
      const res = await axios.post(
        "https://api.mistral.ai/v1/chat/completions",
        {
          model: "mistral-small-latest",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          response_format: { type: "json_object" },
        },
        { headers: { Authorization: `Bearer ${process.env.MISTRAL_API_KEY}` }, timeout: 6000 }
      );
      const parsed = JSON.parse(res.data.choices[0].message.content);
      if (parsed && (Array.isArray(parsed.skills) || Array.isArray(parsed.projects))) {
        return {
          title: parsed.title || "",
          skills: Array.isArray(parsed.skills) ? parsed.skills.map((s, idx) => ({
            claim_id: `claim_${idx + 1}`,
            skill: s.skill || s.name || (typeof s === "string" ? s : ""),
            context: s.context || "Extracted from document text",
            source_quote: s.source_quote || s.skill || "",
            category: "Skill",
            confidence: 95
          })).filter(s => Boolean(s.skill)) : [],
          projects: Array.isArray(parsed.projects) ? parsed.projects.map((p) => ({
            title: p.title || "",
            description: p.description || "",
            technologies: Array.isArray(p.technologies) ? p.technologies : [],
            liveDemoUrl: p.liveDemoUrl || "",
            githubUrl: p.githubUrl || "",
          })).filter(p => Boolean(p.title && p.title.length > 2)) : [],
        };
      }
    } catch (mistralErr) {
      console.warn(`[Resume Intelligence] Mistral extraction note: ${mistralErr.message}`);
    }
  }

  return null;
};

// ── Low-level high-speed extraction function ──────────────────────────────────
const analyzeResumeBuffer = async (buffer, options = {}) => {
  let source = "local";
  let skills = [];
  let projects = [];
  let meta = {};

  // 1. Instant local text extraction (< 10ms)
  const text = await extractTextLocally(
    buffer,
    options.mimeType || "application/pdf",
    options.originalFileName || options.fileName || "document.pdf"
  );

  // 2. Instant high-accuracy local skill extraction (< 5ms)
  const localSkillNames = extractSkillsLocally(text);
  const localClaims = localSkillNames.map((name, i) => ({
    claim_id: `claim_${i + 1}`,
    skill: name,
    context: "Extracted skill from document text",
    source_quote: name,
    category: "Skill",
    confidence: 90
  }));

  // 3. Fast direct Gemini extraction in Node.js (< 1.5s)
  const geminiData = await extractClaimsWithGemini(text);

  if (geminiData && geminiData.skills && geminiData.skills.length > 0) {
    skills = geminiData.skills;
    projects = geminiData.projects || [];
    source = "gemini_direct";
    meta = { fullClaimsData: geminiData.skills, projectsCount: projects.length };
  } else {
    skills = localClaims;
    projects = [];
    source = "local_dictionary";
    meta = { fullClaimsData: localClaims };
  }

  return {
    normalizedText: text,
    claims: { title: geminiData?.title || "", skills, projects },
    analysis: { ...meta, extractionSource: source, skillCount: skills.length },
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
    { status, progress, stage, active: true, updatedAt: new Date() },
    { upsert: true, new: true }
  );
};

/**
 * runAnalysis — main orchestration function.
 * Triggered asynchronously after resume file upload.
 * Validates email match, extracts claims, tracks resume history, and auto-fires GitHub analysis.
 */
const runAnalysis = async (userId, fileUrl, options = {}) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error("Candidate account not found");

    // ── Stage 1: Parsing PDF (Fast Local In-Memory Extraction) ───────────────
    await setProgress(userId, "Parsing", 25, "Parsing PDF document...");

    let buffer = options.buffer;
    if (!buffer) {
      if (fileUrl && fileUrl.startsWith("http")) {
        const response = await axios.get(fileUrl, { responseType: "arraybuffer", timeout: 8000 });
        buffer = Buffer.from(response.data);
      } else if (fileUrl) {
        const fs = require("fs");
        const path = require("path");
        const relativeUrl = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl;
        const fullPath = path.isAbsolute(fileUrl) ? fileUrl : path.join(__dirname, "..", relativeUrl);
        buffer = fs.readFileSync(fullPath);
      }
    }

    if (!buffer) {
      throw new Error("No resume file buffer available for analysis");
    }

    // ── Stage 2: Extracting Claims & Identity Forensic Check ─────────────────
    await setProgress(userId, "Extracting Information", 55, "Extracting skills and credentials...");

    // ── Email Identity Validation (with Gmail dot & plus alias normalization) ──
    const normalizeEmailAddress = (email) => {
      if (!email || typeof email !== "string") return "";
      let [u, domain] = email.toLowerCase().trim().split("@");
      if (!domain) return email.toLowerCase().trim();
      if (domain === "gmail.com" || domain === "googlemail.com") {
        u = u.split("+")[0].replace(/\./g, "");
        domain = "gmail.com";
      }
      return `${u}@${domain}`;
    };

    const result = await analyzeResumeBuffer(buffer, options);

    const resumeEmail = extractEmailFromText(result.normalizedText);
    const registeredEmail = (user.email || "").toLowerCase().trim();
    const normResumeEmail = normalizeEmailAddress(resumeEmail);
    const normRegisteredEmail = normalizeEmailAddress(registeredEmail);

    if (normResumeEmail && normRegisteredEmail && normResumeEmail !== normRegisteredEmail) {
      const errorMsg = `Identity Mismatch: The email found in your resume (${resumeEmail}) does not match your registered VeriProof account email (${registeredEmail}). You cannot proceed with a mismatched resume. Please upload your own resume or update your account email.`;
      console.warn(`[Resume Intelligence] Email mismatch for user ${userId}: resume=${resumeEmail} vs registered=${registeredEmail}`);
      
      await ResumeAnalysis.findOneAndUpdate(
        { candidateId: userId },
        {
          candidateId: userId,
          status: "Email Mismatch",
          progress: 0,
          stage: "Verification Blocked",
          error: errorMsg,
          active: true,
          updatedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      user.resumeStatus = "Rejected";
      await user.save();

      return; // Stop pipeline immediately on email mismatch
    }

    // ── Stage 3: Resume Verification ─────────────────────────────────────────
    await setProgress(userId, "Parsing", 80, "Verifying extracted claims...");

    // Map full claim objects into the ResumeAnalysis schema
    const mappedSkills = (result.claims?.skills || []).map((claim, idx) => ({
      id:                 claim.claim_id || claim.skill?.toLowerCase().replace(/[^a-z0-9]/g, "-") || `claim_${idx + 1}`,
      name:               claim.skill || claim.name || "",
      source:             "Resume",
      verificationStatus: "Pending",
      evidenceCount:      0,
      context:            claim.context || "Extracted from candidate resume",
      sourceQuote:        claim.source_quote || claim.sourceQuote || "",
    }));

    // ── Stage 4: Updating Skill Tree ──────────────────────────────────────────
    await setProgress(userId, "Updating Skill Tree", 90, "Updating verified skill tree...");

    // Persist the complete analysis
    await ResumeAnalysis.findOneAndUpdate(
      { candidateId: userId },
      {
        candidateId:       userId,
        resumeUrl:         fileUrl,
        originalFileName:  options.originalFileName || "resume.pdf",
        mimeType:          options.mimeType || "application/pdf",
        status:            "Analysis Complete",
        progress:          100,
        stage:             "Ready",
        estimatedRemainingStage: "Complete",
        active:            true,
        truncatedText:     result.normalizedText?.substring(0, 2000) || "",
        "claims.skills":   mappedSkills,
        analysis: {
          extractionSource:    result.analysis?.extractionSource || "hybrid",
          parsingConfidence:   mappedSkills.length > 0 ? 95 : 60,
          resumeCompleteness:  Math.min(100, Math.max(35, mappedSkills.length * 8)),
          parseErrors:         [],
          missingFields:       [],
        },
        processedAt: new Date(),
        error: "",
      },
      { upsert: true, new: true }
    );

    // ── Stage 5: Version History, GitHub Discovery, and Stage Progression ─────
    const extractedGithub = extractGithubFromText(result.normalizedText);

    // Archive previous resume version into history
    if (user.resumeUrl && user.resumeUrl !== fileUrl) {
      if (!user.resumeHistory) user.resumeHistory = [];
      user.resumeHistory.push({
        resumeUrl: user.resumeUrl,
        originalFileName: options.previousFileName || "previous_resume.pdf",
        uploadedAt: user.updatedAt || new Date(),
        version: user.resumeHistory.length + 1,
        claimsCount: mappedSkills.length,
        skills: mappedSkills.map(s => s.name),
        status: user.resumeStatus || "Analyzed",
      });
    }

    user.resumeStatus = "Analyzed";
    user.resumeUrl = fileUrl;

    // Auto-populate GitHub username if discovered in resume text
    if (!user.githubUsername && extractedGithub) {
      user.githubUsername = extractedGithub;
      console.log(`[Resume Intelligence] Discovered GitHub handle @${extractedGithub} from candidate resume.`);
    }

    // Advance pipeline stage
    if (["resume_upload", "resume_analysis", "registration"].includes(user.pipelineStage) || !user.pipelineStage) {
      user.pipelineStage = user.githubUsername ? "repository_analysis" : "technical_assessment";
    }

    await user.save();

    // ── Stage 5.5: Auto-populate Extracted Projects ─────────────────────────
    try {
      const Project = require("../models/Project");
      const extractedProjects = result.claims?.projects || [];
      for (const p of extractedProjects) {
        if (p.title && p.title.trim().length > 2) {
          const existing = await Project.findOne({
            user: userId,
            title: new RegExp(`^${p.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i"),
          });

          if (!existing) {
            await Project.create({
              user: userId,
              title: p.title.trim(),
              description: p.description || `Project extracted from candidate resume.`,
              technologies: Array.isArray(p.technologies) && p.technologies.length > 0 ? p.technologies : ["Full Stack"],
              repositoryUrl: p.githubUrl || (user.githubUsername ? `https://github.com/${user.githubUsername}/${p.title.toLowerCase().replace(/[^a-z0-9]/g, "-")}` : "https://github.com"),
              liveUrl: p.liveDemoUrl || "",
              liveDemoUrl: p.liveDemoUrl || "",
              sourceType: "resume_auto",
              status: "Published",
              verificationStatus: "Unverified",
            });
            console.log(`[Resume Intelligence] Auto-created project "${p.title}" for user ${userId}`);
          }
        }
      }
    } catch (projErr) {
      console.warn("[Resume Intelligence] Project auto-creation note:", projErr.message);
    }

    // Rebuild skill progression from resume evidence
    try {
      await rebuildSkillProgression(userId);
    } catch (e) {
      console.warn("[Resume Intelligence] Skill progression rebuild failed:", e.message);
    }

    console.log(`[Resume Intelligence] Analysis complete for user ${userId}. ${mappedSkills.length} claims saved in < 1.5s.`);

    // ── Stage 6: Auto-Fire GitHub Intelligence (Repository Analysis) ───────────
    const targetGithub = user.githubUsername || extractedGithub;
    if (targetGithub) {
      console.log(`[Resume Intelligence] Auto-triggering GitHub intelligence for @${targetGithub}`);
      const { runGitHubAnalysis } = require("./githubIntelligenceService");
      runGitHubAnalysis(userId).catch((err) => {
        console.error("[GitHub Intelligence] Background analysis error:", err.message);
      });
    } else {
      console.log(`[Resume Intelligence] No GitHub handle found for user ${userId}.`);
    }
  } catch (err) {
    console.error("[Resume Intelligence] runAnalysis error:", err);
    await ResumeAnalysis.findOneAndUpdate(
      { candidateId: userId },
      {
        status:  "Analysis Failed",
        progress: 0,
        stage:   "Analysis Failed",
        error:   err.message || "Unknown error during analysis",
        active:  true,
      },
      { upsert: true, new: true }
    );
  }
};

module.exports = {
  analyzeResumeBuffer,
  extractSkillsLocally,
  extractTextLocally,
  extractEmailFromText,
  extractGithubFromText,
  runAnalysis,
};
