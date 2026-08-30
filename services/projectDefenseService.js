const { GoogleGenerativeAI } = require("@google/generative-ai");
const Project = require("../models/Project");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const User = require("../models/User");

/**
 * Extracts a concise summary of the candidate's GitHub repositories & AST codebase evidence.
 */
const getCandidateGithubSummary = async (candidateId) => {
  try {
    const projects = await Project.find({ user: candidateId }).lean();
    if (projects && projects.length > 0) {
      const summaryParts = projects.map((p, idx) => {
        const title = p.title || p.githubStats?.repoName || `Project ${idx + 1}`;
        const desc = p.description || p.projectClaimSummary || "Full-stack web architecture";
        const tech = (p.techStack || p.languages || []).join(", ");
        const metrics = p.githubStats
          ? `Commits: ${p.githubStats.commitsCount || 0}, Files: ${p.githubStats.filesCount || 0}, Stars: ${p.githubStats.stars || 0}`
          : "";
        const astEvidence = p.astAnalysis
          ? `AST Complexity: ${p.astAnalysis.complexityScore || "Moderate"}, Key APIs: ${(p.astAnalysis.endpoints || []).slice(0, 3).join("; ")}`
          : "";
        return `Project [${title}]: ${desc}. Tech: [${tech}]. ${metrics}. ${astEvidence}`.trim();
      });
      return summaryParts.join("\n");
    }

    // Fallback: Check Resume Analysis claims & projects
    const analysis = await ResumeAnalysis.findOne({ candidateId, active: true }).lean();
    if (analysis && analysis.claims?.projects && analysis.claims.projects.length > 0) {
      return analysis.claims.projects
        .map((p) => `Project [${p.title || p.name}]: ${p.description || "Production system"}. Technologies: ${(p.technologies || []).join(", ")}`)
        .join("\n");
    }

    // Default architecture synthesis
    const candidate = await User.findById(candidateId).lean();
    const skills = (candidate?.skills || []).join(", ") || "React, Node.js, REST APIs, PostgreSQL";
    return `Microservices & Web Application Architecture implementing ${skills}. Built modular backend REST APIs with decoupled frontend components and database persistence.`;
  } catch (err) {
    console.error("[projectDefenseService] Error fetching GitHub summary:", err.message);
    return "Full-Stack web service with REST API endpoints, JWT authentication, and relational/document database storage.";
  }
};

/**
 * Phase 3: Stage 2 (Adaptive Project Defense - AI Triggered)
 * Generates 3 scenario-based defense questions requiring the candidate to refactor/apply
 * their real codebase to the JD's architectural requirements.
 *
 * @param {string|ObjectId} candidateId
 * @param {string|object} jdContext - Extracted project_context or JD description
 * @returns {Promise<Array<{ scenario_question: string }>>}
 */
const generateProjectDefense = async (candidateId, jdContext = "") => {
  const cleanJdContext = typeof jdContext === "string"
    ? jdContext
    : Array.isArray(jdContext)
    ? jdContext.join("; ")
    : (jdContext?.project_context ? jdContext.project_context.join("; ") : "Design and scale microservices and responsive web platforms");

  const githubSummary = await getCandidateGithubSummary(candidateId);

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!geminiKey) {
    console.warn("[projectDefenseService] No Gemini key found. Using deterministic fallback questions.");
    return [
      {
        scenario_question: `Based on your submitted repository architecture (${githubSummary.slice(0, 100)}...), how would you refactor your data persistence layer and caching strategies to meet the requirements of: ${cleanJdContext.slice(0, 120)}?`,
      },
      {
        scenario_question: `In your existing codebase, how would you redesign the API gateway and authentication pipeline to support high-throughput scalability specified in the target role (${cleanJdContext.slice(0, 100)}...)?`,
      },
      {
        scenario_question: `Explain how you would write integration and regression test suites for your project components when migrating to the target environment: ${cleanJdContext.slice(0, 120)}.`,
      },
    ];
  }

  const prompt = `You are a Staff Engineer interviewing a candidate for a role requiring: ${cleanJdContext}. The candidate submitted a GitHub project with this architecture: ${githubSummary}. Generate 3 scenario-based questions forcing the candidate to explain how they would refactor or apply their specific code to meet the new JD requirements. Do not ask generic trivia. Output strictly as a raw JSON array of objects with key 'scenario_question'. Example format: [{"scenario_question": "..."}, {"scenario_question": "..."}, {"scenario_question": "..."}]`;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt);
    const rawText = (result.response.text() || "").replace(/```json|```/g, "").trim();

    let parsed = [];
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      console.error("[projectDefenseService] JSON parse error:", e.message);
    }

    const questions = Array.isArray(parsed)
      ? parsed
      : (parsed.questions || parsed.scenario_questions || []);

    const validQuestions = questions
      .map((q) => {
        const text = typeof q === "string" ? q : q.scenario_question || q.question || "";
        return { scenario_question: text.trim() };
      })
      .filter((q) => q.scenario_question && q.scenario_question.length > 20);

    if (validQuestions.length >= 3) {
      return validQuestions.slice(0, 3);
    }

    if (validQuestions.length > 0) {
      return validQuestions;
    }

    throw new Error("Invalid question structure returned from LLM");
  } catch (error) {
    console.error("[projectDefenseService] Gemini defense generation error, falling back:", error.message);
    return [
      {
        scenario_question: `Given your project's architecture (${githubSummary.slice(0, 80)}...), how would you redesign your state management and API contract to fulfill: ${cleanJdContext.slice(0, 100)}?`,
      },
      {
        scenario_question: `How would you profile, benchmark, and optimize the bottleneck endpoints in your submitted GitHub repo to handle the traffic patterns required by: ${cleanJdContext.slice(0, 100)}?`,
      },
      {
        scenario_question: `Describe the failure modes, error handling strategies, and circuit-breakers you would introduce into your project to align with: ${cleanJdContext.slice(0, 100)}.`,
      },
    ];
  }
};

/**
 * Phase 3: Zero-shot grading of Stage 2 defense answers based on architectural depth.
 * Assigns a 0-100 score and qualitative feedback.
 *
 * @param {Array<{ scenario_question: string, candidate_answer: string }>} qaPairs
 * @param {string} jdContext
 * @returns {Promise<{ examDefenseScore: number, breakdown: Array, overallFeedback: string }>}
 */
const evaluateDefenseAnswers = async (qaPairs = [], jdContext = "") => {
  if (!Array.isArray(qaPairs) || qaPairs.length === 0) {
    return {
      examDefenseScore: 0,
      breakdown: [],
      overallFeedback: "No defense answers submitted.",
    };
  }

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!geminiKey) {
    // Deterministic grading heuristic based on answer length, technical keywords, and structure
    let totalScore = 0;
    const breakdown = qaPairs.map((pair, idx) => {
      const answer = (pair.candidate_answer || "").trim();
      let score = 50; // baseline
      if (answer.length > 150) score += 20;
      if (answer.length > 300) score += 15;
      if (/(refactor|architecture|latency|cache|database|async|worker|scale|index|microservice|concurrency|security|jwt|docker)/i.test(answer)) {
        score += 15;
      }
      score = Math.min(100, Math.max(0, score));
      totalScore += score;
      return {
        questionIndex: idx,
        scenario_question: pair.scenario_question,
        candidate_answer: answer,
        score,
        feedback: score >= 75 ? "Strong architectural justification." : "Acceptable response with room for deeper trade-off analysis.",
      };
    });

    const examDefenseScore = Math.round(totalScore / qaPairs.length);
    return {
      examDefenseScore,
      breakdown,
      overallFeedback: "Evaluated via architectural heuristic grading engine.",
    };
  }

  const prompt = `You are a Principal Software Architect evaluating a candidate's architectural defense answers for a role requiring: ${jdContext || "Enterprise Software Engineering"}.

Evaluate each question and answer pair for:
1. Concrete architectural depth and trade-off analysis (not vague hand-waving).
2. Practical feasibility of refactoring the specific codebase.
3. Awareness of failure modes, performance bottlenecks, and scalability.

Question and Answer submissions:
${JSON.stringify(qaPairs, null, 2)}

Output strictly a JSON object conforming to this schema:
{
  "examDefenseScore": 85,
  "breakdown": [
    {
      "questionIndex": 0,
      "score": 85,
      "feedback": "Detailed justification citing database indexing and microservices concurrency."
    }
  ],
  "overallFeedback": "High architectural competency and realistic refactoring roadmap."
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
    const rawText = (result.response.text() || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(rawText);

    const defenseScore = Math.max(0, Math.min(100, Number(parsed.examDefenseScore) || 75));
    const breakdown = Array.isArray(parsed.breakdown) ? parsed.breakdown : [];
    const overallFeedback = parsed.overallFeedback || "Architectural defense evaluated successfully.";

    return {
      examDefenseScore: defenseScore,
      breakdown,
      overallFeedback,
    };
  } catch (err) {
    console.error("[projectDefenseService] Grading error, utilizing heuristic fallback:", err.message);
    let totalScore = 0;
    const breakdown = qaPairs.map((pair, idx) => {
      const answer = (pair.candidate_answer || "").trim();
      let score = answer.length > 100 ? 75 : 50;
      totalScore += score;
      return {
        questionIndex: idx,
        scenario_question: pair.scenario_question,
        candidate_answer: answer,
        score,
        feedback: "Evaluated with architectural fallback heuristics.",
      };
    });
    return {
      examDefenseScore: Math.round(totalScore / qaPairs.length),
      breakdown,
      overallFeedback: "Defense answers processed via fallback evaluator.",
    };
  }
};

module.exports = {
  getCandidateGithubSummary,
  generateProjectDefense,
  evaluateDefenseAnswers,
};
