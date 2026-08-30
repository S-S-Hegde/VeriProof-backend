const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Fallback heuristic extractor if Gemini API is offline or rate-limited.
 */
const fallbackExtractJD = (rawJDText = "") => {
  const text = String(rawJDText || "");
  const lower = text.toLowerCase();

  const knownSkills = [
    "JavaScript", "TypeScript", "Python", "Java", "Go", "Golang", "Rust", "C++", "C#", ".NET",
    "React", "React.js", "Next.js", "Vue", "Vue.js", "Angular", "Svelte",
    "Node.js", "Express", "NestJS", "FastAPI", "Django", "Flask", "Spring Boot",
    "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Cassandra", "DynamoDB",
    "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "CI/CD", "GitHub Actions",
    "GraphQL", "REST", "gRPC", "WebSockets", "Kafka", "RabbitMQ", "Microservices",
    "TailwindCSS", "CSS3", "HTML5", "Redux", "Zustand", "Jest", "PyTest", "Cypress"
  ];

  const matchedSkills = [];
  knownSkills.forEach((skill) => {
    const escaped = skill.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(text)) {
      matchedSkills.push(skill);
    }
  });

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•\d.]+\s*/, ""))
    .filter((l) => l.length > 25 && /(build|design|develop|architect|scale|manage|maintain|implement|optimize|lead|migrate|deploy|integrate)/i.test(l));

  const projectContext = lines.slice(0, 8);

  return {
    core_skills: Array.from(new Set(matchedSkills)),
    project_context: projectContext.length > 0 ? projectContext : ["Design and implement scalable technical solutions", "Collaborate on core architectural initiatives"]
  };
};

/**
 * Phase 1: JD Ingestion & Semantic Splitting Service
 * Parses raw Job Description text into two distinct arrays:
 * - core_skills: Non-negotiable hard skills, languages, tools
 * - project_context: Architectural goals and daily responsibilities
 *
 * @param {string} rawJDText
 * @returns {Promise<{ core_skills: string[], project_context: string[] }>}
 */
const parseJobDescription = async (rawJDText = "") => {
  if (!rawJDText || typeof rawJDText !== "string" || !rawJDText.trim()) {
    return {
      core_skills: [],
      project_context: []
    };
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    console.warn("[jdParsingService] GEMINI_API_KEY not configured. Using deterministic fallback.");
    return fallbackExtractJD(rawJDText);
  }

  const prompt = `You are a Principal Technical Recruiter and Software Architect.
Analyze the following Job Description (JD) and semantically split it into two structured arrays.

CRITICAL REQUIREMENTS:
1. "core_skills": Extract non-negotiable hard technical skills, programming languages, frameworks, cloud platforms, databases, and engineering tools (e.g. "React", "Node.js", "PostgreSQL", "AWS", "Docker", "Kafka"). Normalize names properly.
2. "project_context": Extract architectural goals, technical responsibilities, engineering problems to solve, and daily project scope (e.g. "build low-latency microservices", "migrate monolithic PostgreSQL to distributed cluster", "architect real-time event streaming pipeline").

Job Description Content:
"""
${rawJDText.slice(0, 12000)}
"""

Output strictly a raw JSON object conforming exactly to this schema:
{
  "core_skills": ["string"],
  "project_context": ["string"]
}`;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt);
    const rawOutput = (result.response.text() || "").replace(/```json|```/g, "").trim();

    const parsed = JSON.parse(rawOutput);

    const core_skills = Array.isArray(parsed.core_skills)
      ? Array.from(new Set(parsed.core_skills.map((s) => String(s).trim()).filter(Boolean)))
      : [];

    const project_context = Array.isArray(parsed.project_context)
      ? Array.from(new Set(parsed.project_context.map((c) => String(c).trim()).filter(Boolean)))
      : [];

    // If output is empty, fallback
    if (core_skills.length === 0 && project_context.length === 0) {
      return fallbackExtractJD(rawJDText);
    }

    return {
      core_skills,
      project_context,
    };
  } catch (error) {
    console.error("[jdParsingService] Gemini extraction failed, utilizing fallback heuristic:", error.message);
    return fallbackExtractJD(rawJDText);
  }
};

module.exports = {
  parseJobDescription,
  fallbackExtractJD,
};
