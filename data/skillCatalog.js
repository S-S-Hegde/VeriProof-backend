const skillCatalog = [
  {
    key: "programming",
    name: "Programming Languages",
    description: "Core language fluency that unlocks framework and platform depth.",
    accent: "#38bdf8",
    skills: [
      { id: "javascript", name: "JavaScript", level: 1, xp: 120, prerequisites: [], triggers: ["javascript", "js", "ecmascript"] },
      { id: "typescript", name: "TypeScript", level: 2, xp: 160, prerequisites: ["javascript"], triggers: ["typescript", "ts"] },
      { id: "python", name: "Python", level: 1, xp: 120, prerequisites: [], triggers: ["python", "py"] },
      { id: "java", name: "Java", level: 1, xp: 120, prerequisites: [], triggers: ["java", "spring"] },
    ],
  },
  {
    key: "frontend",
    name: "Frontend",
    description: "Client-side product engineering, UI systems, and modern app delivery.",
    accent: "#22c55e",
    skills: [
      { id: "html-css", name: "HTML/CSS", level: 1, xp: 90, prerequisites: [], triggers: ["html", "css", "tailwind", "bootstrap"] },
      { id: "react", name: "React", level: 2, xp: 180, prerequisites: ["javascript", "html-css"], triggers: ["react", "reactjs"] },
      { id: "nextjs", name: "Next.js", level: 3, xp: 220, prerequisites: ["react"], triggers: ["next", "next.js", "nextjs"] },
      { id: "frontend-testing", name: "Frontend Testing", level: 3, xp: 180, prerequisites: ["react"], triggers: ["jest", "vitest", "testing-library", "cypress", "playwright"] },
    ],
  },
  {
    key: "backend",
    name: "Backend",
    description: "APIs, services, auth flows, and server-side architecture.",
    accent: "#f59e0b",
    skills: [
      { id: "nodejs", name: "Node.js", level: 1, xp: 140, prerequisites: ["javascript"], triggers: ["node", "node.js", "nodejs"] },
      { id: "express", name: "Express", level: 2, xp: 180, prerequisites: ["nodejs"], triggers: ["express", "express.js"] },
      { id: "authentication", name: "Authentication", level: 3, xp: 210, prerequisites: ["express"], triggers: ["jwt", "auth", "authentication", "oauth", "bcrypt"] },
      { id: "rest-api", name: "REST API", level: 2, xp: 170, prerequisites: ["nodejs"], triggers: ["api", "rest", "crud", "endpoint"] },
    ],
  },
  {
    key: "database",
    name: "Database",
    description: "Persistence, modeling, query design, and data integrity.",
    accent: "#14b8a6",
    skills: [
      { id: "mongodb", name: "MongoDB", level: 1, xp: 130, prerequisites: [], triggers: ["mongodb", "mongo"] },
      { id: "mongoose", name: "Mongoose", level: 2, xp: 170, prerequisites: ["mongodb", "nodejs"], triggers: ["mongoose", "schema", "model"] },
      { id: "aggregation", name: "Aggregation", level: 3, xp: 200, prerequisites: ["mongodb"], triggers: ["aggregation", "aggregate", "pipeline"] },
      { id: "sql", name: "SQL", level: 1, xp: 130, prerequisites: [], triggers: ["sql", "postgres", "mysql", "sqlite"] },
    ],
  },
  {
    key: "devops",
    name: "DevOps",
    description: "Shipping, deployment automation, observability, and runtime operations.",
    accent: "#a855f7",
    skills: [
      { id: "git-github", name: "Git/GitHub", level: 1, xp: 100, prerequisites: [], triggers: ["git", "github", "pull request", "repository"] },
      { id: "docker", name: "Docker", level: 2, xp: 190, prerequisites: ["git-github"], triggers: ["docker", "container", "dockerfile"] },
      { id: "ci-cd", name: "CI/CD", level: 3, xp: 220, prerequisites: ["git-github"], triggers: ["ci", "cd", "github actions", "jenkins", "pipeline"] },
      { id: "kubernetes", name: "Kubernetes", level: 4, xp: 260, prerequisites: ["docker"], triggers: ["kubernetes", "k8s"] },
    ],
  },
  {
    key: "ai-ml",
    name: "AI/ML",
    description: "Machine learning, applied AI, and intelligent product workflows.",
    accent: "#ec4899",
    skills: [
      { id: "data-analysis", name: "Data Analysis", level: 2, xp: 170, prerequisites: ["python"], triggers: ["pandas", "numpy", "data analysis"] },
      { id: "machine-learning", name: "Machine Learning", level: 3, xp: 240, prerequisites: ["python", "data-analysis"], triggers: ["machine learning", "ml", "scikit", "tensorflow", "pytorch"] },
      { id: "generative-ai", name: "Generative AI", level: 4, xp: 260, prerequisites: ["python"], triggers: ["gemini", "openai", "llm", "generative ai", "prompt"] },
    ],
  },
  {
    key: "cloud",
    name: "Cloud",
    description: "Managed infrastructure, hosting, and cloud-native deployment.",
    accent: "#06b6d4",
    skills: [
      { id: "cloud-basics", name: "Cloud Basics", level: 1, xp: 120, prerequisites: [], triggers: ["cloud", "hosting", "deployment"] },
      { id: "aws", name: "AWS", level: 2, xp: 200, prerequisites: ["cloud-basics"], triggers: ["aws", "ec2", "s3", "lambda"] },
      { id: "vercel", name: "Vercel", level: 2, xp: 150, prerequisites: ["frontend"], triggers: ["vercel"] },
      { id: "render-railway", name: "Render/Railway", level: 2, xp: 150, prerequisites: ["backend"], triggers: ["render", "railway"] },
    ],
  },
  {
    key: "cybersecurity",
    name: "Cybersecurity",
    description: "Secure engineering, threat awareness, and application hardening.",
    accent: "#ef4444",
    skills: [
      { id: "security-basics", name: "Security Basics", level: 1, xp: 120, prerequisites: [], triggers: ["security", "cybersecurity", "owasp"] },
      { id: "secure-auth", name: "Secure Auth", level: 3, xp: 220, prerequisites: ["authentication", "security-basics"], triggers: ["jwt", "oauth", "session", "password hashing"] },
      { id: "api-security", name: "API Security", level: 3, xp: 210, prerequisites: ["rest-api", "security-basics"], triggers: ["rate limit", "cors", "helmet", "validation"] },
    ],
  },
  {
    key: "fullstack",
    name: "Full Stack",
    description: "End-to-end product construction across frontend, backend, and data layers.",
    accent: "#6366f1",
    skills: [
      { id: "mern-stack", name: "MERN Stack", level: 4, xp: 320, prerequisites: ["react", "express", "mongodb", "mongoose"], triggers: ["mern", "full stack", "fullstack"] },
      { id: "portfolio-architecture", name: "Portfolio Architecture", level: 4, xp: 260, prerequisites: ["react", "rest-api", "git-github"], triggers: ["portfolio", "dashboard", "analytics"] },
    ],
  },
];

const flattenCatalog = () =>
  skillCatalog.flatMap((category) =>
    category.skills.map((skill) => ({
      ...skill,
      categoryKey: category.key,
      categoryName: category.name,
      accent: category.accent,
    })),
  );

module.exports = {
  skillCatalog,
  flatSkillCatalog: flattenCatalog(),
};
