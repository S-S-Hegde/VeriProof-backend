/**
 * ══════════════════════════════════════════════════════════════════════════════
 * projectAuthenticityService.js
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Project Authenticity Verification — a pipeline of independently-testable,
 * independently-callable functions that collectively answer:
 *
 *   "Did this candidate genuinely author the project they are claiming?"
 *
 * Functions:
 *  1. checkOwnershipProvenance     — email-match, fork detection, bulk-import
 *  2. computeFingerprintSimilarity — AST-level corpus + peer comparison
 *  3. computeStyleDeviation        — vs candidate's own baseline fingerprint
 *  4. computeDevelopmentPatternScore — commit cadence naturalness
 *  5. generateAndScoreInterrogation — commit-specific Q generation / grading
 *  6. computeAuthenticityScore     — composite formula
 *  7. runFullAuthenticityPipeline  — orchestrator called from adaptiveExamService
 *
 * All functions are ADDITIVE to the existing services. They reuse:
 *  - githubIntelligenceService.js  ghGet / ghHeaders helpers (via axios directly
 *    with the same env token, to avoid a circular require)
 *  - @google/generative-ai (gemini-2.5-flash)  — already configured in env
 */

const axios              = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const ProjectAuthenticity = require("../models/ProjectAuthenticity");

// ── GitHub REST helpers (mirrors githubIntelligenceService to avoid circular dep) ──
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ghHeaders = () => {
  const h = { "User-Agent": "VeriProof-Authenticity-Engine" };
  if (GITHUB_TOKEN) h["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return h;
};
const ghGet = async (url) => {
  try {
    const { data } = await axios.get(url, {
      headers: ghHeaders(),
      timeout: 10000,
    });
    return data;
  } catch (err) {
    console.warn(`[Authenticity] GitHub GET ${url} failed: ${err.message}`);
    return null;
  }
};

// ── Parse owner/repo from GitHub URL ──────────────────────────────────────────
const parseRepoUrl = (repoUrl) => {
  if (!repoUrl || typeof repoUrl !== "string") return null;
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
};

// ── Gemini client ─────────────────────────────────────────────────────────────
const getGeminiModel = () => {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const genAI = new GoogleGenerativeAI(key);
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });
};

// Bulk-import threshold: all commits within 10 minutes AND > 5 commits
const BULK_IMPORT_THRESHOLD_SECONDS = 600;

// ══════════════════════════════════════════════════════════════════════════════
// 1. checkOwnershipProvenance
// ══════════════════════════════════════════════════════════════════════════════

/**
 * checkOwnershipProvenance
 *
 * Verifies whether the candidate plausibly authored the commits in this repo.
 *
 * @param {string}  repoUrl               — GitHub repo URL
 * @param {object}  candidateUserRecord   — User document (email, githubHandle, emails[], createdAt)
 * @returns {Promise<{
 *   repoOwnerVerified: boolean,
 *   isFork: boolean,
 *   forkUpstream: string|null,
 *   bulkImportFlag: boolean,
 *   accountAgeConsistencyFlag: boolean,
 *   commitCount: number,
 *   firstCommitAt: Date|null,
 *   lastCommitAt: Date|null,
 *   commitHistory: Array,
 * }>}
 */
const checkOwnershipProvenance = async (repoUrl, candidateUserRecord) => {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) {
    return {
      repoOwnerVerified: false, isFork: false, forkUpstream: null,
      bulkImportFlag: false, accountAgeConsistencyFlag: false,
      commitCount: 0, firstCommitAt: null, lastCommitAt: null, commitHistory: [],
    };
  }

  const { owner, repo } = parsed;
  const base = `https://api.github.com/repos/${owner}/${repo}`;

  // Fetch repo metadata + up to 100 commits in parallel
  const [repoData, commitsRaw] = await Promise.all([
    ghGet(base),
    ghGet(`${base}/commits?per_page=100`),
  ]);

  const commits = Array.isArray(commitsRaw) ? commitsRaw : [];
  const commitCount = commits.length;

  // ── Fork detection ──
  const isFork = Boolean(repoData?.fork);
  const forkUpstream = isFork ? (repoData?.parent?.html_url || null) : null;

  // ── Bulk import flag ──
  let bulkImportFlag = false;
  let firstCommitAt = null;
  let lastCommitAt = null;
  if (commits.length > 0) {
    const dates = commits
      .map((c) => new Date(c.commit?.author?.date || c.commit?.committer?.date))
      .filter((d) => !isNaN(d))
      .sort((a, b) => a - b);

    if (dates.length > 0) {
      firstCommitAt = dates[0];
      lastCommitAt  = dates[dates.length - 1];
      const deltaSeconds = (lastCommitAt - firstCommitAt) / 1000;
      bulkImportFlag = commitCount > 5 && deltaSeconds < BULK_IMPORT_THRESHOLD_SECONDS;
    }
  }

  // ── Owner verification: compare commit author emails to candidate emails ──
  const candidateEmails = new Set(
    [
      candidateUserRecord?.email,
      candidateUserRecord?.googleEmail,
      ...(candidateUserRecord?.emails || []),
    ]
      .filter(Boolean)
      .map((e) => e.toLowerCase())
  );

  const candidateHandle = (
    candidateUserRecord?.githubHandle ||
    candidateUserRecord?.githubUsername ||
    ""
  ).toLowerCase();

  let matchCount = 0;
  for (const c of commits.slice(0, 30)) {
    const authorEmail  = (c.commit?.author?.email  || "").toLowerCase();
    const authorLogin  = (c.author?.login           || "").toLowerCase();
    if (
      candidateEmails.has(authorEmail) ||
      (candidateHandle && authorLogin === candidateHandle)
    ) {
      matchCount++;
    }
  }

  const repoOwnerVerified = commits.length === 0
    ? false
    : matchCount / Math.min(commits.length, 30) >= 0.3; // ≥30% commits authored by candidate

  // ── Account age consistency ──
  // If repo's first commit predates the candidate's VeriProof account creation by > 2 years,
  // that's fine. Flag only if account was created AFTER the claimed repo work was done
  // by an implausible margin (repo is older than GitHub account by > 1 year and no commits match).
  let accountAgeConsistencyFlag = false;
  if (firstCommitAt && repoData?.owner?.created_at) {
    const githubAccountCreated = new Date(repoData.owner.created_at);
    const diffDays = (firstCommitAt - githubAccountCreated) / (1000 * 86400);
    // Negative = account created before first commit (normal)
    // Large positive = first commit happened before this account existed (suspicious)
    accountAgeConsistencyFlag = diffDays < -365 && matchCount === 0;
  }

  return {
    repoOwnerVerified,
    isFork,
    forkUpstream,
    bulkImportFlag,
    accountAgeConsistencyFlag,
    commitCount,
    firstCommitAt,
    lastCommitAt,
    commitHistory: commits.slice(0, 50), // retain for downstream steps
  };
};

// ══════════════════════════════════════════════════════════════════════════════
// 2. computeFingerprintSimilarity
// ══════════════════════════════════════════════════════════════════════════════

/**
 * computeFingerprintSimilarity
 *
 * Lightweight structural fingerprint comparison without heavy AST libraries.
 * Uses file-name patterns, identifier density, comment style, and import
 * patterns as a practical proxy for the AST comparison described in the spec.
 *
 * NOTE: The "knownCorpusIndex" is implemented as a static in-memory reference
 * set of telltale patterns from popular bootcamp starter templates
 * (create-react-app, vite default, express-generator, etc.). Built once at
 * module load, never recomputed per request.
 *
 * @param {string}  repoUrl                — GitHub repo URL
 * @param {Array}   candidatePastRepoUrls  — other repos to compare baseline
 * @param {Array}   peerRepoUrls           — other candidates' repos in same job pool
 * @returns {Promise<{ knownCorpusMatch: number, peerCandidateMatch: Array }>}
 */

// ── Static known-corpus fingerprints (built once at module load) ───────────
const KNOWN_CORPUS_PATTERNS = [
  // CRA / Vite scaffold tells
  /src\/App\.(jsx?|tsx?)/i,
  /public\/index\.html/i,
  /src\/index\.(jsx?|tsx?)/i,
  /reportWebVitals/i,
  /setupTests/i,
  // Express-generator tells
  /routes\/index\.js/i,
  /routes\/users\.js/i,
  /bin\/www/i,
  /views\/error\.(jade|pug)/i,
  // Django starter tells
  /manage\.py/i,
  /settings\.py/i,
  /wsgi\.py/i,
  // Spring Boot starter tells
  /src\/main\/java/i,
  /src\/test\/java/i,
  /Application\.java/i,
];

/**
 * Score a file tree against the known corpus. Returns 0-100.
 * Higher = more similar to scaffolded/tutorial template.
 */
const scoreAgainstCorpus = (treePaths) => {
  if (!Array.isArray(treePaths) || treePaths.length === 0) return 0;
  let hits = 0;
  for (const pattern of KNOWN_CORPUS_PATTERNS) {
    if (treePaths.some((p) => pattern.test(p))) hits++;
  }
  return Math.round((hits / KNOWN_CORPUS_PATTERNS.length) * 100);
};

/**
 * Compute a simple structural fingerprint from a repo's file tree.
 * Returns a Set of normalized path segments used for Jaccard similarity.
 */
const buildTreeFingerprint = (treePaths) => {
  if (!Array.isArray(treePaths)) return new Set();
  return new Set(
    treePaths
      .filter((p) => !/node_modules|\.lock$|package-lock|yarn\.lock|dist\/|build\//i.test(p))
      .map((p) => {
        // Normalize: strip numeric suffixes, lowercase, keep extension
        const parts = p.split("/");
        return parts.map((seg) => seg.replace(/\d+/g, "N").toLowerCase()).join("/");
      })
  );
};

const jaccardSimilarity = (setA, setB) => {
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return Math.round((intersection.size / union.size) * 100);
};

const getRepoTree = async (repoUrl) => {
  const parsed = parseRepoUrl(repoUrl);
  if (!parsed) return [];
  const { owner, repo } = parsed;
  const repoData = await ghGet(`https://api.github.com/repos/${owner}/${repo}`);
  const defaultBranch = repoData?.default_branch || "main";
  const treeData = await ghGet(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`
  );
  return (treeData?.tree || []).map((f) => f.path).filter(Boolean);
};

const computeFingerprintSimilarity = async (repoUrl, candidatePastRepoUrls = [], peerRepoUrls = []) => {
  // Fetch target repo tree
  const targetTree = await getRepoTree(repoUrl);
  const targetFP   = buildTreeFingerprint(targetTree);

  // Known corpus match
  const knownCorpusMatch = scoreAgainstCorpus(targetTree);

  // Peer candidate comparison
  const peerCandidateMatch = [];
  for (const peerEntry of peerRepoUrls.slice(0, 10)) { // cap at 10 peers
    try {
      const peerTree = await getRepoTree(peerEntry.repoUrl || peerEntry);
      const peerFP   = buildTreeFingerprint(peerTree);
      const score    = jaccardSimilarity(targetFP, peerFP);
      peerCandidateMatch.push({
        candidateId: peerEntry.candidateId || null,
        score,
      });
    } catch (_) { /* silent */ }
  }

  return { knownCorpusMatch, peerCandidateMatch };
};

// ══════════════════════════════════════════════════════════════════════════════
// 3. computeStyleDeviation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * computeStyleDeviation
 *
 * Compares the claimed repo's fingerprint against the candidate's baseline
 * fingerprint (built from their other, less-contested repos).
 *
 * Returns: styleDeviationScore (0 = perfectly consistent, 100 = totally unlike)
 *
 * @param {string}  repoUrl                    — claimed repo
 * @param {string[]}candidateBaselineRepoUrls  — other repos to build baseline
 * @returns {Promise<number>}
 */
const computeStyleDeviation = async (repoUrl, candidateBaselineRepoUrls = []) => {
  if (candidateBaselineRepoUrls.length === 0) return 50; // no baseline → neutral

  const targetTree = await getRepoTree(repoUrl);
  const targetFP   = buildTreeFingerprint(targetTree);

  // Build merged baseline fingerprint from all other repos
  const baselineFPParts = [];
  for (const bUrl of candidateBaselineRepoUrls.slice(0, 5)) {
    try {
      const bTree = await getRepoTree(bUrl);
      baselineFPParts.push(...buildTreeFingerprint(bTree));
    } catch (_) { /* silent */ }
  }
  const baselineFP = new Set(baselineFPParts);

  if (baselineFP.size === 0) return 50;

  // Jaccard similarity between target and baseline → invert to get deviation
  const similarity = jaccardSimilarity(targetFP, baselineFP);
  return Math.max(0, Math.min(100, 100 - similarity));
};

// ══════════════════════════════════════════════════════════════════════════════
// 4. computeDevelopmentPatternScore
// ══════════════════════════════════════════════════════════════════════════════

/**
 * computeDevelopmentPatternScore
 *
 * Analyzes commit history for organic development signals.
 * Scores naturalness (messy is GOOD, suspiciously clean is the flag).
 *
 * Signals evaluated:
 *  - Commit message diversity (not all identical length/structure)
 *  - Fix-after-feature frequency (real devs fix things)
 *  - Time-of-day distribution (not all at 3 AM in batch)
 *  - Commit message quality variance (mix of short and descriptive)
 *
 * @param {Array} commitHistory — raw GitHub commits array
 * @returns {number} developmentPatternScore (0-100, higher = more organic)
 */
const computeDevelopmentPatternScore = (commitHistory) => {
  if (!Array.isArray(commitHistory) || commitHistory.length < 3) {
    return 50; // insufficient data → neutral
  }

  const commits = commitHistory.slice(0, 100);
  const messages = commits.map((c) => (c.commit?.message || "").split("\n")[0].trim());

  // ── Signal 1: Message diversity ──
  const uniqueMessages = new Set(messages.map((m) => m.toLowerCase())).size;
  const messageDiversityRatio = uniqueMessages / messages.length; // 1 = all unique (good)

  // ── Signal 2: Fix/refactor commits (organic iteration) ──
  const fixKeywords = /\b(fix|bug|error|typo|oops|revert|patch|hotfix|correct|broken|broke|repair)\b/i;
  const fixCount = messages.filter((m) => fixKeywords.test(m)).length;
  const fixRatio = fixCount / messages.length; // ~0.1–0.3 is natural

  // ── Signal 3: Time-of-day distribution ──
  const hours = commits
    .map((c) => {
      const d = new Date(c.commit?.author?.date || c.commit?.committer?.date);
      return isNaN(d) ? null : d.getUTCHours();
    })
    .filter((h) => h !== null);

  let timeDistributionScore = 50;
  if (hours.length >= 5) {
    const hourSet = new Set(hours).size;
    // High variety of hours = more natural
    timeDistributionScore = Math.min(100, (hourSet / 12) * 100);
  }

  // ── Signal 4: WIP / incremental commits (not just polished big-bang) ──
  const wipKeywords = /\b(wip|progress|initial|draft|temp|todo|placeholder|cleanup|refactor|minor)\b/i;
  const wipCount = messages.filter((m) => wipKeywords.test(m)).length;
  const wipPresence = wipCount > 0 ? 20 : 0; // bonus for having WIP commits

  // ── Signal 5: Message length variance ──
  const lengths = messages.map((m) => m.length);
  const avgLen  = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + Math.pow(b - avgLen, 2), 0) / lengths.length;
  const stdDev  = Math.sqrt(variance);
  const lengthVarianceScore = Math.min(100, stdDev * 5); // higher std dev = more natural

  // ── Composite naturalness score ──
  const score = Math.round(
    messageDiversityRatio * 25 +
    Math.min(fixRatio * 200, 25) + // cap fix ratio contribution at 25
    timeDistributionScore * 0.20 +
    wipPresence +
    lengthVarianceScore * 0.10
  );

  return Math.max(0, Math.min(100, score));
};

// ══════════════════════════════════════════════════════════════════════════════
// 5. generateAndScoreInterrogation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * generateAndScoreInterrogation
 *
 * When candidateAnswers is null: SELECT 3-5 non-trivial commits and call the
 * LLM to generate commit-specific questions.
 *
 * When candidateAnswers is provided: call LLM to grade each answer on
 * specificity (0-100) — does it reflect genuine first-hand authorship?
 *
 * @param {string}  repoUrl
 * @param {Array}   commitHistory     — raw GitHub commits
 * @param {Array|null} candidateAnswers — [{ questionId, answer }] or null
 * @returns {Promise<{ questions?: Array, specificityScores?: Array }>}
 */
const TRIVIAL_COMMIT_PATTERNS = /\b(wip|init|initial commit|add readme|update readme|typo|whitespace|format|style|lint|merge|bump version|prettier)\b/i;

const selectNonTrivialCommits = (commitHistory, maxCount = 5) => {
  return commitHistory
    .filter((c) => {
      const msg = (c.commit?.message || "").toLowerCase();
      return !TRIVIAL_COMMIT_PATTERNS.test(msg) && msg.length > 5;
    })
    .slice(0, maxCount);
};

const generateAndScoreInterrogation = async (repoUrl, commitHistory, candidateAnswers = null) => {
  const model = getGeminiModel();
  const parsed = parseRepoUrl(repoUrl);
  const repoName = parsed?.repo || "unknown";

  // ── GENERATION MODE ──────────────────────────────────────────────────────
  if (candidateAnswers === null) {
    const selectedCommits = selectNonTrivialCommits(commitHistory, 5);
    if (selectedCommits.length === 0) {
      return { questions: [] };
    }

    const commitsPayload = selectedCommits.map((c) => ({
      sha: (c.sha || "").slice(0, 7),
      message: (c.commit?.message || "").split("\n")[0].trim(),
      // GitHub commit API doesn't give diff inline; use files list as proxy
      diff_summary: (c.files || []).map((f) => `${f.status} ${f.filename}`).join(", ") || "see commit",
      files_changed: (c.files || []).map((f) => f.filename).slice(0, 5),
    }));

    if (!model) {
      // Deterministic fallback — generic but still commit-anchored
      return {
        questions: selectedCommits.map((c) => ({
          commitSha: (c.sha || "").slice(0, 7),
          diffSummary: `Commit: ${(c.commit?.message || "").split("\n")[0].slice(0, 80)}`,
          question: `In commit ${(c.sha || "").slice(0, 7)}, you made changes described as "${(c.commit?.message || "").split("\n")[0].slice(0, 60)}". What specific problem were you solving and what alternative approach did you consider before choosing this implementation?`,
          expectedAnswerShape: "Should reference the specific change and give a concrete reason beyond restating the commit message.",
        })),
      };
    }

    const generationPrompt = `You are generating project-defense questions for a technical hiring verification system.

Input:
repo_context: { "name": "${repoName}", "primary_language": "unknown" }
commits: ${JSON.stringify(commitsPayload, null, 2)}

RULES:
1. Ask about WHY a specific change was made, not WHAT it does.
2. Reference ACTUAL diff content specifically — variable names, the specific before/after.
3. Where the diff shows a bug fix, ask what the original symptom was and how they diagnosed it.
4. Do not ask questions answerable from the commit message alone.
5. Generate exactly one question per commit provided.

OUTPUT (JSON only):
{
  "questions": [
    {
      "commit_sha": "string",
      "question": "string — specific, references actual code/diff content",
      "expected_answer_shape": "string — what a genuine author's answer should touch on, NOT shown to candidate"
    }
  ]
}`;

    try {
      const result = await model.generateContent(generationPrompt);
      const rawText = (result.response.text() || "").replace(/```json|```/g, "").trim();
      const parsed  = JSON.parse(rawText);
      const questions = (parsed.questions || []).map((q, idx) => ({
        commitSha:           q.commit_sha || (selectedCommits[idx]?.sha || "").slice(0, 7),
        diffSummary:         commitsPayload[idx]?.diff_summary || "",
        question:            q.question || "",
        expectedAnswerShape: q.expected_answer_shape || "",
      }));
      return { questions };
    } catch (err) {
      console.error("[Authenticity] Question generation error:", err.message);
      return { questions: [] };
    }
  }

  // ── GRADING MODE ─────────────────────────────────────────────────────────
  const specificityScores = [];

  for (const answer of candidateAnswers) {
    if (!model) {
      // Heuristic grading: longer + specific = higher score
      const text  = (answer.candidateAnswer || "").trim();
      const score = Math.min(100, 20 + text.length / 5 + (text.split(" ").length > 30 ? 20 : 0));
      specificityScores.push({
        questionId:       answer.questionId,
        specificityScore: Math.round(score),
        rationale:        "Scored via heuristic fallback (LLM unavailable).",
      });
      continue;
    }

    const gradingPrompt = `You are grading a candidate's defense of a specific commit they claim to have authored.
You are NOT checking factual correctness — you are checking whether this answer reflects genuine first-hand authorship.

Input:
question: "${answer.question || ""}"
expected_answer_shape: "${answer.expectedAnswerShape || ""}"
diff_summary: "${answer.diffSummary || ""}"
candidate_answer: "${(answer.candidateAnswer || "").replace(/"/g, "'")}"

SCORE 0-100 on SPECIFICITY:
HIGH (toward 100): References the actual before/after state accurately. Describes a plausible concrete reason tied to the specific diff. Mentions a constraint/trade-off/symptom not obvious from just reading the final code.
LOW (toward 0): Generic/textbook explanation. Restates commit message without adding info. Factually inconsistent with what diff shows. Vague, evasive, avoids the specific "why".

Do NOT penalize imperfect grammar or informal tone.

OUTPUT (JSON only):
{
  "specificity_score": 0-100,
  "rationale": "1-2 sentences plain English for the recruiter-facing report"
}`;

    try {
      const result  = await model.generateContent(gradingPrompt);
      const rawText = (result.response.text() || "").replace(/```json|```/g, "").trim();
      const graded  = JSON.parse(rawText);
      specificityScores.push({
        questionId:       answer.questionId,
        specificityScore: Math.max(0, Math.min(100, Number(graded.specificity_score) || 0)),
        rationale:        graded.rationale || "",
      });
    } catch (err) {
      console.error("[Authenticity] Answer grading error:", err.message);
      specificityScores.push({
        questionId:       answer.questionId,
        specificityScore: 50,
        rationale:        "Grading inconclusive due to model error.",
      });
    }
  }

  return { specificityScores };
};

// ══════════════════════════════════════════════════════════════════════════════
// 6. computeAuthenticityScore
// ══════════════════════════════════════════════════════════════════════════════

/**
 * computeAuthenticityScore
 *
 * Composite formula (weights from spec):
 *   authenticityScore = 100
 *     - w1 * (ownershipRiskFlags ? 100 : 0)               // w1 = 0.30
 *     - w2 * fingerprintSimilarity.peerCandidateMatch.max  // w2 = 0.20
 *     - w3 * styleDeviationScore                           // w3 = 0.15
 *     - w4 * (100 - interrogationSpecificityAvg)           // w4 = 0.25
 *     + w5 * developmentPatternScore                       // w5 = 0.10 (bonus)
 *   clamped to [0, 100]
 *
 * @param {object} signals — all upstream signal objects
 * @returns {{ authenticityScore: number, reviewStatus: string }}
 */
const computeAuthenticityScore = ({
  repoOwnerVerified,
  bulkImportFlag,
  accountAgeConsistencyFlag,
  fingerprintSimilarity = {},
  styleDeviationScore = 50,
  developmentPatternScore = 50,
  interrogation = {},
}) => {
  // Ownership risk = any of the three provenance red flags
  const ownershipRisk = !repoOwnerVerified || bulkImportFlag || accountAgeConsistencyFlag;

  // Max peer similarity score
  const peerMatches = (fingerprintSimilarity.peerCandidateMatch || []).map((m) => m.score || 0);
  const maxPeerMatch = peerMatches.length > 0 ? Math.max(...peerMatches) : 0;

  // Average interrogation specificity
  const questions = (interrogation.questions || []).filter(
    (q) => q.specificityScore !== null && q.specificityScore !== undefined
  );
  const interrogationSpecificityAvg =
    questions.length > 0
      ? questions.reduce((s, q) => s + q.specificityScore, 0) / questions.length
      : 50; // neutral if no answers yet

  const W1 = 0.30;
  const W2 = 0.20;
  const W3 = 0.15;
  const W4 = 0.25;
  const W5 = 0.10;

  const raw =
    100 -
    W1 * (ownershipRisk ? 100 : 0) -
    W2 * maxPeerMatch -
    W3 * styleDeviationScore -
    W4 * (100 - interrogationSpecificityAvg) +
    W5 * developmentPatternScore;

  const authenticityScore = Math.max(0, Math.min(100, Math.round(raw)));

  // ── Review status assignment ──
  const knownCorpusMatch    = fingerprintSimilarity.knownCorpusMatch || 0;
  const genuinelyBuilt      = interrogationSpecificityAvg >= 60 && !ownershipRisk;
  const highCorpusButGenuine = knownCorpusMatch >= 60 && genuinelyBuilt;

  let reviewStatus;
  if (ownershipRisk || interrogationSpecificityAvg < 25) {
    reviewStatus = "auto_flag";
  } else if (highCorpusButGenuine || (!ownershipRisk && authenticityScore >= 65)) {
    reviewStatus = "auto_pass";
  } else {
    reviewStatus = "manual_review_required";
  }

  return { authenticityScore, reviewStatus };
};

// ══════════════════════════════════════════════════════════════════════════════
// 7. runFullAuthenticityPipeline
// ══════════════════════════════════════════════════════════════════════════════

/**
 * runFullAuthenticityPipeline
 *
 * Orchestrator called from adaptiveExamService during the Purgatory window.
 * Creates / upserts a ProjectAuthenticity document for each claimed project.
 * Returns the generated interrogation questions to be injected into Phase 2.
 *
 * Non-blocking: each step stores partial results on the doc; Phase 2 start
 * is NOT gated on this completing.
 *
 * @param {object} opts
 * @param {string}   opts.repoUrl
 * @param {ObjectId} opts.candidateId
 * @param {ObjectId} opts.examId
 * @param {object}   opts.candidateUserRecord       — full User document
 * @param {string[]} opts.candidateBaselineRepoUrls — candidate's other repos
 * @param {Array}    opts.peerRepoEntries            — [{ candidateId, repoUrl }] from same job pool
 * @returns {Promise<{ interrogationQuestions: Array }>}
 */
const runFullAuthenticityPipeline = async ({
  repoUrl,
  candidateId,
  examId,
  candidateUserRecord,
  candidateBaselineRepoUrls = [],
  peerRepoEntries = [],
}) => {
  // Upsert placeholder doc so we can store partial results immediately
  let doc = await ProjectAuthenticity.findOneAndUpdate(
    { candidateId, repoUrl },
    {
      $setOnInsert: {
        candidateId, examId, repoUrl,
        reviewStatus: "pending",
        computedAt: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const pipelineErrors = [];

  // ── Step 1: Ownership provenance ──────────────────────────────────────────
  let commitHistory = [];
  try {
    const provenance = await checkOwnershipProvenance(repoUrl, candidateUserRecord);
    commitHistory = provenance.commitHistory || [];

    await ProjectAuthenticity.updateOne(
      { _id: doc._id },
      {
        $set: {
          repoOwnerVerified:         provenance.repoOwnerVerified,
          isFork:                    provenance.isFork,
          forkUpstream:              provenance.forkUpstream,
          bulkImportFlag:            provenance.bulkImportFlag,
          accountAgeConsistencyFlag: provenance.accountAgeConsistencyFlag,
          commitCount:               provenance.commitCount,
          firstCommitAt:             provenance.firstCommitAt,
          lastCommitAt:              provenance.lastCommitAt,
        },
      }
    );
  } catch (err) {
    console.error("[Authenticity] Step 1 error:", err.message);
    pipelineErrors.push(`step1_provenance: ${err.message}`);
  }

  // ── Step 2: Fingerprint similarity ────────────────────────────────────────
  try {
    const fp = await computeFingerprintSimilarity(repoUrl, candidateBaselineRepoUrls, peerRepoEntries);
    await ProjectAuthenticity.updateOne(
      { _id: doc._id },
      { $set: { fingerprintSimilarity: fp } }
    );
  } catch (err) {
    console.error("[Authenticity] Step 2 error:", err.message);
    pipelineErrors.push(`step2_fingerprint: ${err.message}`);
  }

  // ── Step 3: Style deviation ───────────────────────────────────────────────
  try {
    const deviation = await computeStyleDeviation(repoUrl, candidateBaselineRepoUrls);
    await ProjectAuthenticity.updateOne(
      { _id: doc._id },
      { $set: { styleDeviationScore: deviation } }
    );
  } catch (err) {
    console.error("[Authenticity] Step 3 error:", err.message);
    pipelineErrors.push(`step3_style: ${err.message}`);
  }

  // ── Step 4: Development pattern ───────────────────────────────────────────
  try {
    const patternScore = computeDevelopmentPatternScore(commitHistory);
    await ProjectAuthenticity.updateOne(
      { _id: doc._id },
      { $set: { developmentPatternScore: patternScore } }
    );
  } catch (err) {
    console.error("[Authenticity] Step 4 error:", err.message);
    pipelineErrors.push(`step4_pattern: ${err.message}`);
  }

  // ── Step 5: Generate interrogation questions ──────────────────────────────
  let interrogationQuestions = [];
  try {
    const { questions } = await generateAndScoreInterrogation(repoUrl, commitHistory, null);
    interrogationQuestions = questions || [];

    // Persist questions into the doc
    await ProjectAuthenticity.updateOne(
      { _id: doc._id },
      { $set: { "interrogation.questions": interrogationQuestions } }
    );
  } catch (err) {
    console.error("[Authenticity] Step 5 error:", err.message);
    pipelineErrors.push(`step5_interrogation: ${err.message}`);
  }

  // ── Step 6: Compute composite score (on what's available so far) ──────────
  try {
    // Re-fetch doc with fresh values
    const freshDoc = await ProjectAuthenticity.findById(doc._id).lean();
    const { authenticityScore, reviewStatus } = computeAuthenticityScore({
      repoOwnerVerified:         freshDoc.repoOwnerVerified,
      bulkImportFlag:            freshDoc.bulkImportFlag,
      accountAgeConsistencyFlag: freshDoc.accountAgeConsistencyFlag,
      fingerprintSimilarity:     freshDoc.fingerprintSimilarity,
      styleDeviationScore:       freshDoc.styleDeviationScore,
      developmentPatternScore:   freshDoc.developmentPatternScore,
      interrogation:             freshDoc.interrogation,
    });

    await ProjectAuthenticity.updateOne(
      { _id: doc._id },
      {
        $set: {
          authenticityScore,
          reviewStatus,
          computedAt: new Date(),
          pipelineErrors,
        },
      }
    );
  } catch (err) {
    console.error("[Authenticity] Step 6 composite error:", err.message);
  }

  return { interrogationQuestions };
};

module.exports = {
  checkOwnershipProvenance,
  computeFingerprintSimilarity,
  computeStyleDeviation,
  computeDevelopmentPatternScore,
  generateAndScoreInterrogation,
  computeAuthenticityScore,
  runFullAuthenticityPipeline,
};
