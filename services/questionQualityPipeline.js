/**
 * ══════════════════════════════════════════════════════════════════════
 * Question Quality Pipeline — LLM Bias Elimination Engine
 * ══════════════════════════════════════════════════════════════════════
 *
 * 3-Pass question generation strategy that eliminates all common LLM
 * biases: length bias, jargon density, hedging patterns, absurd
 * distractors, and structural answer position patterns.
 *
 * Pass 1: Generate scenario question + correct answer (no distractors)
 * Pass 2: Generate adversarial distractors (length-matched, jargon-matched)
 * Pass 3: Automated code-based quality gates (reject biased questions)
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const QuestionBank = require("../models/QuestionBank");

// ── Hedging words that LLMs disproportionately put in correct answers ──
const HEDGING_PATTERNS = [
  "typically", "usually", "in most cases", "depending on",
  "may", "might", "often", "generally", "can sometimes",
  "it depends", "under certain", "in practice", "commonly",
];

// ── Absurd distractor blacklist patterns ──
const ABSURD_PATTERNS = [
  /format.*(hard|disk|drive)/i,
  /delete.*(os|operating|system|all data)/i,
  /crash.*(server|computer|browser|system)/i,
  /send.*(email|sms|notification).*(ceo|admin|boss)/i,
  /destroy.*(database|memory|cpu)/i,
  /turn.*(screen|monitor).*(blue|black|off)/i,
  /explode/i,
  /nuclear/i,
  /physically break/i,
];

// ── Technical keyword list for jargon density measurement ──
const TECHNICAL_KEYWORDS = [
  "api", "async", "await", "callback", "promise", "observable", "stream",
  "middleware", "microservice", "monolith", "cache", "redis", "memcached",
  "index", "query", "join", "aggregate", "pipeline", "schema", "model",
  "jwt", "oauth", "cors", "csrf", "xss", "sql injection", "sanitize",
  "docker", "kubernetes", "container", "pod", "deployment", "ci/cd",
  "webpack", "vite", "bundler", "transpiler", "ast", "parser", "lexer",
  "thread", "process", "mutex", "semaphore", "deadlock", "race condition",
  "garbage collector", "reference counting", "memory leak", "heap", "stack",
  "O(n)", "O(log n)", "O(1)", "big-o", "complexity", "algorithm",
  "tcp", "udp", "http", "websocket", "grpc", "rest", "graphql",
  "component", "hook", "state", "props", "context", "reducer", "effect",
  "virtual dom", "reconciliation", "fiber", "render", "hydration",
  "event loop", "microtask", "macrotask", "call stack", "callback queue",
  "prototype", "closure", "scope", "hoisting", "coercion", "this",
  "orm", "transaction", "acid", "eventual consistency", "cap theorem",
  "shard", "replica", "partition", "load balancer", "reverse proxy",
  "ssl", "tls", "certificate", "encryption", "hash", "salt", "bcrypt",
];

// ── Scenario type prompt templates ──
const SCENARIO_PROMPTS = {
  code_debug: `Generate a debugging scenario with a specific code snippet (15-25 lines) that contains a subtle bug. The candidate must identify what's wrong and select the correct fix.`,
  architecture_flaw: `Generate a system architecture scenario describing a specific microservice design. Include 2-3 architectural details. The candidate must identify the critical flaw.`,
  output_prediction: `Generate a code tracing scenario with a specific code snippet (10-20 lines). The candidate must predict the exact output when executed.`,
  refactoring_choice: `Generate a refactoring scenario with a specific code snippet (15-25 lines) that has a performance or maintainability issue. The candidate must choose the best refactoring approach.`,
  memory_leak_detection: `Generate a memory management scenario with a specific code snippet that has a subtle memory leak or resource leak. The candidate must identify the leak and the fix.`,
  spot_the_bug: `Generate a "Spot the Bug" scenario with a code snippet (10-15 lines) that looks correct at first glance but has a subtle logic error, off-by-one, or edge case bug.`,
};

// ── Difficulty tier descriptions for prompt context ──
const TIER_DESCRIPTIONS = {
  1: "Foundational — Tests basic syntax, common patterns, and terminology. A junior developer or bootcamp graduate should answer correctly.",
  2: "Easy — Tests practical knowledge of standard patterns. A developer with 1-2 years experience should answer correctly.",
  3: "Medium — Tests applied understanding and common pitfalls. A mid-level developer should answer correctly.",
  4: "Hard — Tests deep understanding, edge cases, and production trade-offs. A senior developer should answer correctly.",
  5: "Expert — Tests architectural reasoning, performance implications, and obscure edge cases. Only a principal/staff engineer would consistently answer correctly.",
};

/**
 * Count technical keywords in a text string.
 */
const countTechnicalKeywords = (text) => {
  const lower = text.toLowerCase();
  return TECHNICAL_KEYWORDS.filter((kw) => lower.includes(kw)).length;
};

/**
 * Count hedging words in a text string.
 */
const countHedgingWords = (text) => {
  const lower = text.toLowerCase();
  return HEDGING_PATTERNS.filter((hw) => lower.includes(hw)).length;
};

/**
 * Check if a distractor matches any absurd pattern.
 */
const isAbsurdDistractor = (text) => {
  return ABSURD_PATTERNS.some((pattern) => pattern.test(text));
};

/**
 * Calculate standard deviation of an array of numbers.
 */
const stddev = (arr) => {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
};

// ══════════════════════════════════════════════════════════════════════
// PASS 3: AUTOMATED QUALITY GATES (Pure code, no LLM)
// ══════════════════════════════════════════════════════════════════════

/**
 * Gate 1: Length Variance Check
 * All 4 options must be within ±20% character length of the mean.
 * Returns { passed: bool, details: string, variance: number }
 */
const checkLengthVariance = (correctAnswer, distractors) => {
  const lengths = [correctAnswer, ...distractors].map((opt) => opt.length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = stddev(lengths);
  const maxDeviation = mean * 0.20;

  const outlier = lengths.find((len) => Math.abs(len - mean) > maxDeviation);
  if (outlier !== undefined) {
    return {
      passed: false,
      details: `Option length ${outlier} deviates >20% from mean ${mean.toFixed(0)}. Variance: ${variance.toFixed(1)}`,
      variance,
    };
  }

  return { passed: true, details: "Length variance within acceptable bounds.", variance };
};

/**
 * Gate 2: Jargon Density Parity
 * If the correct answer has 2x+ more technical keywords than the average distractor, reject.
 */
const checkJargonParity = (correctAnswer, distractors) => {
  const correctJargon = countTechnicalKeywords(correctAnswer);
  const distractorJargon = distractors.map(countTechnicalKeywords);
  const avgDistractorJargon = distractorJargon.reduce((a, b) => a + b, 0) / distractorJargon.length;

  if (correctJargon >= 2 && avgDistractorJargon > 0 && correctJargon >= avgDistractorJargon * 2) {
    return {
      passed: false,
      details: `Correct answer has ${correctJargon} technical keywords vs avg distractor ${avgDistractorJargon.toFixed(1)}. Jargon density imbalance.`,
    };
  }

  return { passed: true, details: "Jargon density within acceptable parity." };
};

/**
 * Gate 3: Hedging Pattern Detection
 * If ONLY the correct answer contains hedging language, reject.
 */
const checkHedgingPattern = (correctAnswer, distractors) => {
  const correctHedges = countHedgingWords(correctAnswer);
  const distractorHedges = distractors.map(countHedgingWords);
  const anyDistractorHedges = distractorHedges.some((h) => h > 0);

  if (correctHedges > 0 && !anyDistractorHedges) {
    return {
      passed: false,
      details: `Only the correct answer uses hedging language (${correctHedges} hedge words). Distractors use none.`,
    };
  }

  return { passed: true, details: "Hedging pattern balanced across options." };
};

/**
 * Gate 4: Plausibility Floor
 * Check if any distractor is obviously absurd.
 */
const checkPlausibilityFloor = (distractors) => {
  const absurdOnes = distractors.filter(isAbsurdDistractor);
  if (absurdOnes.length > 0) {
    return {
      passed: false,
      details: `${absurdOnes.length} distractor(s) contain absurd/implausible claims: "${absurdOnes[0].slice(0, 60)}..."`,
    };
  }

  return { passed: true, details: "All distractors pass plausibility floor." };
};

/**
 * Gate 5: Answer Position Distribution (across a question set)
 * If >40% of correct answers in a set land on the same index, flag for reshuffle.
 */
const checkAnswerPositionDistribution = (questions) => {
  if (!questions || questions.length < 5) return { passed: true, details: "Too few questions to check distribution." };

  const positionCounts = [0, 0, 0, 0];
  questions.forEach((q) => {
    if (q.correctOption >= 0 && q.correctOption <= 3) {
      positionCounts[q.correctOption]++;
    }
  });

  const maxCount = Math.max(...positionCounts);
  const maxPercentage = maxCount / questions.length;

  if (maxPercentage > 0.40) {
    return {
      passed: false,
      details: `${(maxPercentage * 100).toFixed(0)}% of correct answers land on position ${positionCounts.indexOf(maxCount)}. Needs reshuffle.`,
      positionCounts,
    };
  }

  return { passed: true, details: "Answer position distribution is balanced.", positionCounts };
};

/**
 * Run all quality gates on a single question.
 * Returns { passed: bool, gateResults: object, qualityScore: number }
 */
const runQualityGates = (correctAnswer, distractors) => {
  const gates = {
    lengthVariance: checkLengthVariance(correctAnswer, distractors),
    jargonParity: checkJargonParity(correctAnswer, distractors),
    hedgingPattern: checkHedgingPattern(correctAnswer, distractors),
    plausibilityFloor: checkPlausibilityFloor(distractors),
  };

  const allPassed = Object.values(gates).every((g) => g.passed);
  const passedCount = Object.values(gates).filter((g) => g.passed).length;
  const qualityScore = Math.round((passedCount / Object.keys(gates).length) * 100);

  return {
    passed: allPassed,
    gateResults: gates,
    qualityScore,
    lengthVariance: gates.lengthVariance.variance || 0,
  };
};

// ══════════════════════════════════════════════════════════════════════
// PASS 1: SCENARIO + CORRECT ANSWER GENERATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate a scenario-based question with code snippet and correct answer.
 * NO distractors are generated in this pass.
 *
 * @param {string} skill - The skill to generate for (e.g., "React", "Node.js")
 * @param {number} difficultyTier - 1-5 difficulty scale
 * @param {string} scenarioType - Type of scenario question
 * @param {string} context - Optional JD context for relevance
 * @returns {Promise<{ question, codeSnippet, codeLanguage, correctAnswer, scenarioType } | null>}
 */
const generateScenarioAndAnswer = async (skill, difficultyTier = 3, scenarioType = "code_debug", context = "") => {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!geminiKey) {
    console.warn("[QuestionQuality] No Gemini API key. Skipping Pass 1.");
    return null;
  }

  const scenarioInstruction = SCENARIO_PROMPTS[scenarioType] || SCENARIO_PROMPTS.code_debug;
  const tierDesc = TIER_DESCRIPTIONS[difficultyTier] || TIER_DESCRIPTIONS[3];

  const codeLanguage = getCodeLanguageForSkill(skill);

  const prompt = `You are an expert technical interviewer creating a scenario-based assessment question.

SKILL: ${skill}
DIFFICULTY TIER: ${difficultyTier}/5 — ${tierDesc}
SCENARIO TYPE: ${scenarioType}
${context ? `JOB CONTEXT: ${context}` : ""}

INSTRUCTIONS:
${scenarioInstruction}

CRITICAL RULES:
1. The code snippet MUST be specific and proprietary — not from any textbook, tutorial, or Stack Overflow answer.
2. The correct answer must be concise (40-120 characters). Do NOT write a paragraph.
3. The question must test APPLIED knowledge, not memorized trivia.
4. The code snippet should be in ${codeLanguage}.

OUTPUT FORMAT — Return ONLY raw JSON (no markdown, no backticks):
{
  "question": "A clear, specific scenario question referencing the code snippet below",
  "code_snippet": "The specific code snippet (15-25 lines, properly formatted with newlines)",
  "code_language": "${codeLanguage}",
  "correct_answer": "A concise correct answer (40-120 characters)"
}`;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
    });

    const result = await model.generateContent(prompt);
    const rawText = (result.response.text() || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(rawText);

    if (
      parsed &&
      typeof parsed.question === "string" && parsed.question.length > 20 &&
      typeof parsed.correct_answer === "string" && parsed.correct_answer.length > 10
    ) {
      return {
        question: parsed.question.trim(),
        codeSnippet: (parsed.code_snippet || "").trim(),
        codeLanguage: parsed.code_language || codeLanguage,
        correctAnswer: parsed.correct_answer.trim(),
        scenarioType,
      };
    }

    console.warn("[QuestionQuality] Pass 1: Invalid structure from LLM.");
    return null;
  } catch (err) {
    console.error("[QuestionQuality] Pass 1 error:", err.message);
    return null;
  }
};

// ══════════════════════════════════════════════════════════════════════
// PASS 2: ADVERSARIAL DISTRACTOR GENERATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate 3 plausible, length-matched, jargon-matched distractors.
 * This is a SEPARATE LLM call to prevent the correct answer length bias.
 *
 * @param {string} question - The question text
 * @param {string} correctAnswer - The correct answer text
 * @param {string} skill - The skill being tested
 * @param {string} codeSnippet - The code snippet (for context)
 * @returns {Promise<string[] | null>} Array of 3 distractors, or null on failure
 */
const generateAdversarialDistractors = async (question, correctAnswer, skill, codeSnippet = "") => {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!geminiKey) return null;

  const correctLength = correctAnswer.length;
  const minLength = Math.floor(correctLength * 0.80);
  const maxLength = Math.ceil(correctLength * 1.20);

  const correctJargonCount = countTechnicalKeywords(correctAnswer);
  const correctHedgeCount = countHedgingWords(correctAnswer);

  const prompt = `You are generating WRONG answers for a technical assessment question. Your goal is to create distractors that are PLAUSIBLE but INCORRECT.

QUESTION: ${question}
${codeSnippet ? `CODE CONTEXT:\n${codeSnippet}` : ""}
SKILL: ${skill}
CORRECT ANSWER: ${correctAnswer}

THE CORRECT ANSWER HAS:
- ${correctLength} characters (each distractor MUST have ${minLength}-${maxLength} characters)
- ${correctJargonCount} technical terms (each distractor must use a similar count of technical terms)
${correctHedgeCount > 0 ? `- ${correctHedgeCount} hedging words like "typically", "usually" (each distractor must also include hedging words)` : `- No hedging words (distractors must NOT use hedging words like "typically", "usually", "in most cases")`}

CRITICAL RULES FOR EACH DISTRACTOR:
1. MUST be between ${minLength} and ${maxLength} characters. This is NON-NEGOTIABLE.
2. MUST use the same level of technical jargon as the correct answer.
3. MUST sound equally confident — same tone, no wishy-washy language differences.
4. MUST be technically WRONG but for subtle, specific reasons that could fool a mid-level developer.
5. MUST NOT be absurd, joking, or obviously fake (no "crashes the server", "deletes all data", etc.).
6. Each distractor must be wrong for a DIFFERENT reason.

OUTPUT FORMAT — Return ONLY a raw JSON array of exactly 3 strings (no markdown, no backticks):
["distractor 1", "distractor 2", "distractor 3"]`;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { temperature: 0.35, responseMimeType: "application/json" },
    });

    const result = await model.generateContent(prompt);
    const rawText = (result.response.text() || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(rawText);

    const distractors = Array.isArray(parsed) ? parsed : (parsed.distractors || []);

    if (distractors.length >= 3 && distractors.every((d) => typeof d === "string" && d.length > 10)) {
      return distractors.slice(0, 3).map((d) => d.trim());
    }

    console.warn("[QuestionQuality] Pass 2: Insufficient distractors from LLM.");
    return null;
  } catch (err) {
    console.error("[QuestionQuality] Pass 2 error:", err.message);
    return null;
  }
};

// ══════════════════════════════════════════════════════════════════════
// COMPLETE PIPELINE: Generate + Validate + Cache
// ══════════════════════════════════════════════════════════════════════

/**
 * Fisher-Yates shuffle for option randomization.
 */
const shuffleArray = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/**
 * Map a skill name to its primary code language.
 */
const getCodeLanguageForSkill = (skill) => {
  const skillLower = (skill || "").toLowerCase();
  if (skillLower.includes("python") || skillLower.includes("django") || skillLower.includes("flask")) return "python";
  if (skillLower.includes("java") && !skillLower.includes("javascript")) return "java";
  if (skillLower.includes("typescript") || skillLower.includes("angular")) return "typescript";
  if (skillLower.includes("go") || skillLower.includes("golang")) return "go";
  if (skillLower.includes("rust")) return "rust";
  if (skillLower.includes("ruby") || skillLower.includes("rails")) return "ruby";
  if (skillLower.includes("sql") || skillLower.includes("postgres") || skillLower.includes("mysql")) return "sql";
  if (skillLower.includes("c#") || skillLower.includes("dotnet") || skillLower.includes(".net")) return "csharp";
  if (skillLower.includes("php") || skillLower.includes("laravel")) return "php";
  if (skillLower.includes("swift") || skillLower.includes("ios")) return "swift";
  if (skillLower.includes("kotlin") || skillLower.includes("android")) return "kotlin";
  return "javascript"; // default
};

/**
 * Select the best scenario type for a given skill and difficulty tier.
 */
const selectScenarioType = (skill, difficultyTier) => {
  const scenarios = Object.keys(SCENARIO_PROMPTS);
  const skillLower = (skill || "").toLowerCase();

  // Tier-aware selection: harder questions → more complex scenarios
  if (difficultyTier >= 4) {
    const hardScenarios = ["architecture_flaw", "memory_leak_detection", "refactoring_choice"];
    return hardScenarios[Math.floor(Math.random() * hardScenarios.length)];
  }

  if (difficultyTier <= 2) {
    const easyScenarios = ["output_prediction", "spot_the_bug", "code_debug"];
    return easyScenarios[Math.floor(Math.random() * easyScenarios.length)];
  }

  // Medium: any scenario type
  return scenarios[Math.floor(Math.random() * scenarios.length)];
};

/**
 * Full 3-pass pipeline: Generate a scenario question with quality-assured options.
 *
 * @param {string} skill - Target skill
 * @param {number} difficultyTier - 1-5 scale
 * @param {string} context - Optional JD context
 * @param {number} maxRetries - Max Pass 2 retries on quality gate failure
 * @returns {Promise<object | null>} Fully formatted question ready for exam, or null
 */
const generateQualityQuestion = async (skill, difficultyTier = 3, context = "", maxRetries = 3) => {
  const scenarioType = selectScenarioType(skill, difficultyTier);

  // ── PASS 1: Generate scenario + correct answer ──
  const pass1 = await generateScenarioAndAnswer(skill, difficultyTier, scenarioType, context);
  if (!pass1) {
    console.warn(`[QuestionQuality] Pass 1 failed for ${skill}. Falling back to QuestionBank.`);
    return null;
  }

  // ── PASS 2 + PASS 3: Generate distractors with retry loop ──
  let bestDistractors = null;
  let bestQuality = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const distractors = await generateAdversarialDistractors(
      pass1.question,
      pass1.correctAnswer,
      skill,
      pass1.codeSnippet
    );

    if (!distractors) {
      console.warn(`[QuestionQuality] Pass 2 attempt ${attempt}/${maxRetries} failed for ${skill}.`);
      continue;
    }

    // ── PASS 3: Quality gates ──
    const quality = runQualityGates(pass1.correctAnswer, distractors);

    if (quality.passed) {
      bestDistractors = distractors;
      bestQuality = quality;
      console.log(`[QuestionQuality] ✓ Pass 3 approved on attempt ${attempt} for ${skill}. Quality: ${quality.qualityScore}%`);
      break;
    }

    console.warn(`[QuestionQuality] Pass 3 rejected attempt ${attempt}/${maxRetries} for ${skill}:`,
      Object.entries(quality.gateResults)
        .filter(([, v]) => !v.passed)
        .map(([k, v]) => `${k}: ${v.details}`)
        .join(" | ")
    );

    // Keep the best attempt in case all retries fail
    if (!bestQuality || quality.qualityScore > bestQuality.qualityScore) {
      bestDistractors = distractors;
      bestQuality = quality;
    }
  }

  if (!bestDistractors) {
    console.warn(`[QuestionQuality] All retries exhausted for ${skill}. Returning null.`);
    return null;
  }

  // ── Shuffle options and determine correct index ──
  const allOptions = [pass1.correctAnswer, ...bestDistractors];
  const shuffled = shuffleArray(allOptions);
  const correctOptionIndex = shuffled.indexOf(pass1.correctAnswer);

  // ── Build final question object ──
  const questionDoc = {
    questionText: pass1.question,
    options: shuffled,
    correctOption: correctOptionIndex,
    skill: skill,
    difficulty: tierToDifficulty(difficultyTier),
    difficultyTier,
    scenarioType: pass1.scenarioType,
    codeSnippet: pass1.codeSnippet || "",
    codeLanguage: pass1.codeLanguage || "",
    section: "Adaptive",
    phase: "adaptive",
    qualityScore: bestQuality.qualityScore,
    lengthVariance: bestQuality.lengthVariance,
    source: bestQuality.passed ? "llm_validated" : "llm",
  };

  // ── Cache to QuestionBank for future reuse ──
  try {
    await QuestionBank.create({
      skillName: skill,
      archetype: scenarioType === "code_debug" ? "Debugging" :
        scenarioType === "architecture_flaw" ? "System Design" :
        scenarioType === "output_prediction" ? "Code Tracing" :
        scenarioType === "refactoring_choice" ? "Anti-patterns" :
        "Debugging",
      question: pass1.question,
      correct_answer: pass1.correctAnswer,
      distractors: bestDistractors,
      difficulty: tierToDifficulty(difficultyTier),
      difficultyTier,
      category: "adaptive",
      scenarioType: pass1.scenarioType,
      codeSnippet: pass1.codeSnippet || "",
      codeLanguage: pass1.codeLanguage || "",
      qualityScore: bestQuality.qualityScore,
      lengthVariance: bestQuality.lengthVariance,
      qualityApproved: bestQuality.passed,
      source: bestQuality.passed ? "llm_validated" : "llm",
    });
    console.log(`[QuestionQuality] Cached validated question for ${skill} (Tier ${difficultyTier}).`);
  } catch (cacheErr) {
    console.warn("[QuestionQuality] Cache save warning:", cacheErr.message);
  }

  return questionDoc;
};

/**
 * Map difficulty tier (1-5) to difficulty string.
 */
const tierToDifficulty = (tier) => {
  if (tier <= 2) return "Easy";
  if (tier === 3) return "Medium";
  return "Hard";
};

/**
 * Map difficulty string to tier number.
 */
const difficultyToTier = (difficulty) => {
  if (difficulty === "Easy") return 2;
  if (difficulty === "Medium") return 3;
  if (difficulty === "Hard") return 4;
  return 3;
};

/**
 * Validate and fix answer position distribution across a question set.
 * If >40% of answers are on the same index, reshuffle the outliers.
 */
const validateAndFixPositionDistribution = (questions) => {
  const check = checkAnswerPositionDistribution(questions);
  if (check.passed) return questions;

  console.log("[QuestionQuality] Fixing answer position distribution...");

  // Reshuffle options on questions whose correct answer is on the over-represented position
  const overRepPos = check.positionCounts.indexOf(Math.max(...check.positionCounts));
  const fixed = questions.map((q) => {
    if (q.correctOption === overRepPos) {
      const correctText = q.options[q.correctOption];
      const shuffled = shuffleArray([...q.options]);
      const newCorrectIdx = shuffled.indexOf(correctText);
      return { ...q, options: shuffled, correctOption: newCorrectIdx };
    }
    return q;
  });

  return fixed;
};

/**
 * Generate a batch of quality-assured questions for a skill at a specific tier.
 * Falls back to QuestionBank cached questions if LLM generation fails.
 *
 * @param {string} skill - Target skill
 * @param {number} count - Number of questions to generate
 * @param {number} difficultyTier - 1-5 scale
 * @param {string} context - Optional JD context
 * @returns {Promise<object[]>} Array of question objects
 */
const generateQualityBatch = async (skill, count, difficultyTier = 3, context = "") => {
  const generated = [];

  // First: try to pull cached quality-approved questions from QuestionBank
  const skillRegex = new RegExp(`^${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const cached = await QuestionBank.aggregate([
    {
      $match: {
        skillName: { $regex: skillRegex },
        difficultyTier: { $gte: difficultyTier - 1, $lte: difficultyTier + 1 },
        category: { $in: ["adaptive", "any"] },
        scenarioType: { $ne: "conceptual" },
        qualityApproved: true,
      },
    },
    { $sample: { size: count } },
  ]);

  const usedTexts = new Set();
  for (const doc of cached) {
    if (generated.length >= count) break;
    if (!usedTexts.has(doc.question)) {
      usedTexts.add(doc.question);
      // Re-shuffle options for freshness
      const allOptions = [doc.correct_answer, ...doc.distractors.slice(0, 3)];
      const shuffled = shuffleArray(allOptions);
      generated.push({
        questionText: doc.question,
        options: shuffled,
        correctOption: shuffled.indexOf(doc.correct_answer),
        skill: doc.skillName,
        difficulty: doc.difficulty || tierToDifficulty(doc.difficultyTier),
        difficultyTier: doc.difficultyTier || difficultyTier,
        scenarioType: doc.scenarioType || "code_debug",
        codeSnippet: doc.codeSnippet || "",
        codeLanguage: doc.codeLanguage || "",
        section: "Adaptive",
        phase: "adaptive",
      });
    }
  }

  // If not enough from cache, generate fresh via 3-pass pipeline
  const remaining = count - generated.length;
  if (remaining > 0) {
    console.log(`[QuestionQuality] Cache has ${generated.length}/${count} for ${skill}. Generating ${remaining} fresh.`);
    for (let i = 0; i < remaining; i++) {
      const q = await generateQualityQuestion(skill, difficultyTier, context);
      if (q && !usedTexts.has(q.questionText)) {
        usedTexts.add(q.questionText);
        generated.push(q);
      }
    }
  }

  return generated;
};

module.exports = {
  // Quality gates (exported for unit testing)
  checkLengthVariance,
  checkJargonParity,
  checkHedgingPattern,
  checkPlausibilityFloor,
  checkAnswerPositionDistribution,
  runQualityGates,
  countTechnicalKeywords,
  countHedgingWords,

  // Pipeline stages
  generateScenarioAndAnswer,
  generateAdversarialDistractors,

  // Main API
  generateQualityQuestion,
  generateQualityBatch,
  validateAndFixPositionDistribution,

  // Helpers
  tierToDifficulty,
  difficultyToTier,
  getCodeLanguageForSkill,
  selectScenarioType,
  shuffleArray,
};
