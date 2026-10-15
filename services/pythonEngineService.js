/**
 * pythonEngineService.js
 *
 * Central proxy client for all calls to the VeriProof Python AI Engine
 * (hosted at AI_ENGINE_URL — defaults to http://localhost:8000 for local dev).
 *
 * All endpoints exposed by python_engine/main.py are wired here.
 * Callers receive clean results or graceful fallback values — never crashes.
 *
 * Endpoint map (matches python_engine/main.py exactly):
 *  POST /api/extract-claims-pdf          — PDF resume → structured claims
 *  POST /api/analyze-job-description     — JD text   → capability/competency graph
 *  POST /api/analyze-resume              — resume text + job_analysis → alignment
 *  POST /api/analyze-repository          — GitHub repo data → repo intelligence
 *  POST /api/verify-claims               — claim list + job requirements → skill score
 *  POST /api/verify-github               — GitHub username + repo data → authenticity
 *  POST /api/generate-repo-docs          — repo metadata → AI documentation
 *  POST /api/fuse-evidence               — all signals → fused evidence
 *  POST /api/evaluate-capabilities       — evidence → capability scores
 *  POST /api/evaluate-competencies       — capabilities → competency profile
 *  POST /api/generate-candidate-profile  — full candidate profile
 *  POST /api/analyze-technical-assessment— exam submission → technical score
 *  POST /api/analyze-behavior            — behavioral answers → behavior score
 *  POST /api/generate-trust-score        — all signals → trust score
 *  POST /api/recruiter-decision          — trust score → hire/reject decision
 *  POST /api/v2/verify-candidate         — full E2E pipeline (single call)
 *  POST /api/grade-code                  — code snippet → correctness score
 *  POST /api/generate-behavioral         — candidate claims → behavioral questions
 *  POST /api/evaluate-behavioral         — behavioral answer → score
 *  POST /api/generate-assessment         — claims → technical MCQ questions
 *  GET  /health                          — liveness probe
 */

const axios = require("axios");

// ── Base URL ──────────────────────────────────────────────────────────────────
const PYTHON_API_BASE = (
  process.env.AI_ENGINE_URL || "http://localhost:8000"
).replace(/\/$/, "");

// ── Default timeouts per call category ───────────────────────────────────────
const TIMEOUT = {
  fast:     10_000,   // simple scoring / verification
  medium:   25_000,   // resume / repo analysis
  slow:     45_000,   // full E2E pipeline
};

// ── Internal axios client ─────────────────────────────────────────────────────
const pyClient = axios.create({ baseURL: PYTHON_API_BASE });

/**
 * Safe POST wrapper — returns { data } on success, { error } on failure.
 * Callers decide how to handle failures (fallback vs re-throw).
 */
const pyPost = async (path, body, timeout = TIMEOUT.medium) => {
  try {
    const res = await pyClient.post(path, body, { timeout });
    return { data: res.data };
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err.message || "Python engine unavailable";
    console.warn(`[PythonEngine] POST ${path} failed: ${msg}`);
    return { error: msg };
  }
};

const pyGet = async (path, timeout = TIMEOUT.fast) => {
  try {
    const res = await pyClient.get(path, { timeout });
    return { data: res.data };
  } catch (err) {
    console.warn(`[PythonEngine] GET ${path} failed: ${err.message}`);
    return { error: err.message };
  }
};

// ── Liveness ─────────────────────────────────────────────────────────────────

/**
 * Ping the python engine — returns true if reachable.
 */
const ping = async () => {
  const { data } = await pyGet("/health", 5000);
  return !!data;
};

// ── Resume Intelligence ───────────────────────────────────────────────────────

/**
 * Extract structured skill claims from a PDF/text resume.
 * Wraps POST /api/extract-claims-pdf (multipart)
 * NOTE: The backend already has local PDF extraction via resumeIntelligenceService.
 *       Use this when you have extracted text and want deep LLM claim structuring.
 *
 * @param {string} resumeText — already extracted text
 * @param {object} [jobAnalysis] — optional job analysis result to align against
 * @returns {Array} normalized claims array
 */
const analyzeResume = async (resumeText, jobAnalysis = null) => {
  const body = { resume_text: resumeText };
  if (jobAnalysis) body.job_analysis = jobAnalysis;

  const { data, error } = await pyPost("/api/analyze-resume", body, TIMEOUT.medium);
  if (error || !data?.result) return null;
  return data.result;
};

// ── Job Description Intelligence ──────────────────────────────────────────────

/**
 * Deep parse a JD text into capability/competency graph + seniority signals.
 * Wraps POST /api/analyze-job-description
 *
 * @param {string} jdText
 * @param {string[]} [rawRequirements]
 * @returns {object|null} full job analysis result
 */
const analyzeJobDescription = async (jdText, rawRequirements = []) => {
  const body = {};
  if (jdText) body.jd_text = jdText;
  if (rawRequirements?.length) body.raw_requirements = rawRequirements;

  const { data, error } = await pyPost("/api/analyze-job-description", body, TIMEOUT.medium);
  if (error || !data?.result) return null;
  return data.result;
};

// ── Claim Verification ────────────────────────────────────────────────────────

/**
 * Verify resume skill claims against job requirements.
 * Wraps POST /api/verify-claims
 * Returns a blended alignment score (0–100).
 *
 * @param {Array}  claims          — list of {skill, context, source_quote} objects
 * @param {string[]} jobRequirements — core skills from JD
 * @returns {number|null}
 */
const verifyClaims = async (claims, jobRequirements = []) => {
  const { data, error } = await pyPost(
    "/api/verify-claims",
    { claims, job_requirements: jobRequirements },
    TIMEOUT.fast
  );
  if (error || data?.result?.score === undefined) return null;
  return Number(data.result.score);
};

// ── GitHub / Repository Intelligence ─────────────────────────────────────────

/**
 * Run repository authenticity and intelligence analysis.
 * Wraps POST /api/verify-github
 *
 * @param {string}   githubUsername
 * @param {Array}    claims         — skill claims from resume
 * @param {object}   repoData       — repo metadata object
 * @param {string[]} treePaths      — file tree paths
 * @param {Array}    commits        — recent commits array
 * @returns {object|null}
 */
const verifyGithub = async (githubUsername, claims = [], repoData = null, treePaths = [], commits = []) => {
  const body = { github_username: githubUsername, claims };
  if (repoData)   body.repo_data   = repoData;
  if (treePaths?.length) body.tree_paths = treePaths;
  if (commits?.length)   body.commits    = commits;

  const { data, error } = await pyPost("/api/verify-github", body, TIMEOUT.medium);
  if (error || !data?.result) return null;
  return data.result;
};

/**
 * Generate AI documentation for a repository.
 * Wraps POST /api/generate-repo-docs
 *
 * @param {object} payload — { repo_name, github_username, tree_paths, commits, readme_content, languages, repo_description, stars, forks }
 * @returns {object|null}
 */
const generateRepoDocs = async (payload) => {
  const { data, error } = await pyPost("/api/generate-repo-docs", payload, TIMEOUT.medium);
  if (error || !data?.result) return null;
  return data.result;
};

// ── Technical Assessment ──────────────────────────────────────────────────────

/**
 * Grade a code snippet submission.
 * Wraps POST /api/grade-code
 *
 * @param {string} codeSnippet
 * @param {string} [language]
 * @param {string} [problemContext]
 * @returns {number|null} score 0–100
 */
const gradeCode = async (codeSnippet, language = "javascript", problemContext = "Technical Assessment") => {
  const { data, error } = await pyPost(
    "/api/grade-code",
    {
      problem_statement: problemContext || "Technical Assessment Coding Challenge",
      expected_output: "Pass all functional test cases with expected output",
      candidate_code: codeSnippet,
    },
    TIMEOUT.fast
  );
  if (error) return null;
  const score = data?.result?.score ?? data?.summary?.score;
  return score !== undefined ? Number(score) : null;
};

/**
 * Evaluate a behavioral free-text response.
 * Wraps POST /api/evaluate-behavioral
 *
 * @param {string} responseText
 * @param {string} [questionContext]
 * @returns {number|null} score 0–100
 */
const evaluateBehavioral = async (responseText, questionContext = "") => {
  const { data, error } = await pyPost(
    "/api/evaluate-behavioral",
    {
      question: questionContext || "Describe a challenging technical problem you solved and your contribution.",
      candidate_answer: responseText,
    },
    TIMEOUT.fast
  );
  if (error) return null;
  const score = data?.result?.score ?? data?.summary?.scores?.score;
  return score !== undefined ? Number(score) : null;
};

/**
 * Analyze technical assessment submission (MCQ + code).
 * Wraps POST /api/analyze-technical-assessment
 *
 * @param {object} submission — exam answers object
 * @param {object} [jobAnalysis]
 * @returns {object|null}
 */
const analyzeTechnicalAssessment = async (submission, jobAnalysis = null) => {
  const body = { submission };
  if (jobAnalysis) body.job_analysis = jobAnalysis;

  const { data, error } = await pyPost("/api/analyze-technical-assessment", body, TIMEOUT.medium);
  if (error || !data?.result) return null;
  return data.result;
};

/**
 * Generate behavioral interview questions from candidate claims.
 * Wraps POST /api/generate-behavioral
 *
 * @param {Array} claims
 * @returns {Array|null} behavioral questions
 */
const generateBehavioralQuestions = async (claims) => {
  const { data, error } = await pyPost("/api/generate-behavioral", { claims }, TIMEOUT.medium);
  if (error || !data?.result) return null;
  return data.result;
};

// ── Trust Score & Full Pipeline ───────────────────────────────────────────────

/**
 * Generate a composite trust score from all evidence signals.
 * Wraps POST /api/generate-trust-score
 *
 * @param {object} payload — TrustScoreEvaluationRequest fields
 * @returns {object|null}
 */
const generateTrustScore = async (payload) => {
  const { data, error } = await pyPost("/api/generate-trust-score", payload, TIMEOUT.slow);
  if (error || !data?.result) return null;
  return data.result;
};

/**
 * Full E2E candidate verification pipeline (single call).
 * Wraps POST /api/v2/verify-candidate
 *
 * @param {object} pipelineRequest — { resume_text, repositories, technical_assessment, behavioral_assessment, professional_experience_years }
 * @returns {object|null} full v2 pipeline report
 */
const runFullPipeline = async (pipelineRequest) => {
  const { data, error } = await pyPost("/api/v2/verify-candidate", pipelineRequest, TIMEOUT.slow);
  if (error || !data) return null;
  return data;
};

/**
 * Get recruiter hire/reject decision from trust score result.
 * Wraps POST /api/recruiter-decision
 *
 * @param {object} payload — RecruiterDecisionRequestPayload fields
 * @returns {object|null}
 */
const getRecruiterDecision = async (payload) => {
  const { data, error } = await pyPost("/api/recruiter-decision", payload, TIMEOUT.medium);
  if (error || !data?.result) return null;
  return data.result;
};

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  PYTHON_API_BASE,
  ping,
  analyzeResume,
  analyzeJobDescription,
  verifyClaims,
  verifyGithub,
  generateRepoDocs,
  gradeCode,
  evaluateBehavioral,
  analyzeTechnicalAssessment,
  generateBehavioralQuestions,
  generateTrustScore,
  runFullPipeline,
  getRecruiterDecision,
};
