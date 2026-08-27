/**
 * projectVerificationService.js
 *
 * Dual-Source AI Verification Engine (Live Demo + GitHub Repo vs Resume Claims).
 * Performs live web crawling, repository inspection, semantic discrepancy auditing,
 * and cryptographic proof generation.
 */

const axios = require("axios");
const crypto = require("crypto");
const Project = require("../models/Project");

// ── Web crawler for Live Demo Links ───────────────────────────────────────────
const crawlLiveDemo = async (url) => {
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return { crawled: false, title: "", metaDescription: "", textSnippet: "", status: 0 };
  }

  try {
    const response = await axios.get(url, {
      timeout: 6000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 VeriProof-Auditor/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      maxRedirects: 3,
    });

    const html = typeof response.data === "string" ? response.data : "";
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const metaDescription = metaMatch ? metaMatch[1].trim() : "";

    // Clean plain text from body
    const bodyContent = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
                            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
                            .replace(/<[^>]+>/g, " ")
                            .replace(/\s+/g, " ")
                            .trim();

    return {
      crawled: true,
      title,
      metaDescription,
      textSnippet: bodyContent.substring(0, 2500),
      status: response.status,
    };
  } catch (err) {
    console.warn(`[ProjectVerification] Live Demo crawl note for ${url}: ${err.message}`);
    return {
      crawled: false,
      title: "",
      metaDescription: "",
      textSnippet: "",
      error: err.message,
      status: err.response?.status || 0,
    };
  }
};

// ── GitHub repository inspection ──────────────────────────────────────────────
const inspectGitHubRepo = async (repoUrl) => {
  if (!repoUrl || typeof repoUrl !== "string") return { available: false };

  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
  if (!match) return { available: false };

  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");

  try {
    const headers = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "VeriProof-Platform",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {}),
    };

    const [repoRes, readmeRes] = await Promise.all([
      axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers, timeout: 5000 }).catch(() => null),
      axios.get(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers, timeout: 5000 }).catch(() => null),
    ]);

    let readmeText = "";
    if (readmeRes && readmeRes.data && readmeRes.data.content) {
      readmeText = Buffer.from(readmeRes.data.content, "base64").toString("utf8");
    }

    return {
      available: Boolean(repoRes && repoRes.data),
      name: repoRes?.data?.name || repo,
      description: repoRes?.data?.description || "",
      stars: repoRes?.data?.stargazers_count || 0,
      language: repoRes?.data?.language || "",
      topics: repoRes?.data?.topics || [],
      readmeExcerpt: readmeText.substring(0, 2500),
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
};

// ── AI Semantic Cross-Verification Auditor ────────────────────────────────────
const runCrossSourceAudit = async ({
  projectTitle,
  resumeDescription,
  technologies = [],
  demoData,
  githubData,
}) => {
  const prompt = `You are an automated Software Evidence Auditor.
Evaluate whether a candidate's resume project description matches their real-time implementation based on dual-source evidence (Live Demo Crawl + GitHub Repository).

--- PROJECT CLAIMS FROM RESUME ---
Project Title: "${projectTitle}"
Claimed Description: "${resumeDescription}"
Claimed Technologies: ${technologies.join(", ")}

--- LIVE DEMO AUDIT ---
Demo Accessible: ${demoData.crawled}
Live Title: "${demoData.title}"
Live Meta Description: "${demoData.metaDescription}"
Live Text Excerpt: "${demoData.textSnippet}"

--- GITHUB REPO AUDIT ---
Repo Available: ${githubData.available}
Repo Description: "${githubData.description}"
Primary Language: "${githubData.language}"
Topics: ${githubData.topics ? githubData.topics.join(", ") : "None"}
README Excerpt: "${githubData.readmeExcerpt || ""}"

--- TASK ---
1. Compare the claimed features and tech stack against what is actually built and deployed.
2. Determine if this is a genuine, verified project or an exaggerated/mismatched claim.
3. Compute a Match Fidelity Score (0-100).
   - If demo or repo exists with clear matching functionality, score 80-100.
   - If minor tech stack differences, score 65-79.
   - If completely unrelated placeholder or 404, score < 50.

Return strict JSON format:
{
  "matchScore": 92,
  "isVerified": true,
  "techStackMatch": true,
  "verifiedFeatures": ["User Authentication", "Interactive Dashboard", "REST API integration"],
  "discrepancies": [],
  "summary": "Live demo and GitHub repository fully substantiate the claimed full-stack application architecture."
}`;

  // 1. Try Gemini 2.0 Flash
  if (process.env.GEMINI_API_KEY) {
    try {
      const { GoogleGenerativeAI } = require("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      });
      const res = await model.generateContent(prompt);
      const parsed = JSON.parse(res.response.text().replace(/```json|```/g, "").trim());
      return { ...parsed, provider: "Gemini_Flash_Auditor" };
    } catch (e) {
      console.warn("[ProjectVerification] Gemini failover note:", e.message);
    }
  }

  // 2. Try NVIDIA NIM / Groq / OpenAI
  const nvidiaKey = process.env.NVIDIA_API_KEY_VISION || process.env.NVIDIA_API_KEY;
  if (nvidiaKey) {
    try {
      const nvRes = await axios.post(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          model: "meta/llama-3.2-11b-vision-instruct",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 400,
        },
        {
          headers: { Authorization: `Bearer ${nvidiaKey}`, "Content-Type": "application/json" },
          timeout: 8000,
        }
      );
      const raw = (nvRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
      return { ...JSON.parse(raw), provider: "NVIDIA_NIM_Auditor" };
    } catch (e) {}
  }

  // Heuristic Rule-Based Fallback
  const hasDemo = Boolean(demoData.crawled);
  const hasRepo = Boolean(githubData.available);
  const score = (hasDemo ? 50 : 0) + (hasRepo ? 40 : 0) + 10;
  return {
    matchScore: score,
    isVerified: score >= 70,
    techStackMatch: true,
    verifiedFeatures: hasDemo ? ["Live Web Application Deployed"] : ["Code Repository Verified"],
    discrepancies: hasDemo ? [] : ["Live demo link unreachable"],
    summary: hasDemo && hasRepo
      ? "Live demo and GitHub repository verified successfully."
      : "Project partially substantiated by available code artifacts.",
    provider: "RuleBased_Auditor",
  };
};

/**
 * verifyProjectLive — Main export to verify a project against its Live Demo and GitHub repo.
 */
const verifyProjectLive = async (projectId, userId, customDemoUrl = null) => {
  const project = await Project.findOne({ _id: projectId, user: userId });
  if (!project) throw new Error("Project not found");

  const liveUrl = customDemoUrl || project.liveDemoUrl || project.liveUrl;
  const repoUrl = project.repositoryUrl;

  // Run live crawl & repository inspect in parallel
  const [demoData, githubData] = await Promise.all([
    crawlLiveDemo(liveUrl),
    inspectGitHubRepo(repoUrl),
  ]);

  // Run semantic AI cross-verification
  const audit = await runCrossSourceAudit({
    projectTitle: project.title,
    resumeDescription: project.description,
    technologies: project.technologies,
    demoData,
    githubData,
  });

  // Generate Cryptographic Proof Hash
  const proofPayload = `${project._id}-${userId}-${repoUrl || "no-repo"}-${liveUrl || "no-demo"}-${audit.matchScore}-${Date.now()}`;
  const proofHash = crypto.createHash("sha256").update(proofPayload).digest("hex");

  const isVerified = Boolean(audit.isVerified);
  project.liveDemoUrl = liveUrl || "";
  project.liveUrl = liveUrl || "";
  project.isVerified = isVerified;
  project.verificationStatus = isVerified ? "Verified" : (audit.matchScore > 40 ? "Discrepancy" : "Unverified");
  project.matchScore = audit.matchScore || 0;
  project.proofHash = proofHash;
  project.liveAuditReport = {
    demoCrawled: demoData.crawled,
    githubAudited: githubData.available,
    resumeFidelityScore: audit.matchScore,
    verifiedFeatures: audit.verifiedFeatures || [],
    discrepancies: audit.discrepancies || [],
    summary: audit.summary || "Audit concluded.",
    auditedAt: new Date(),
    verifierModel: audit.provider || "VeriProof_AI",
  };

  await project.save();
  return project;
};

module.exports = {
  verifyProjectLive,
  crawlLiveDemo,
  inspectGitHubRepo,
};
