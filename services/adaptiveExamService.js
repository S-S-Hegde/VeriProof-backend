/**
 * ══════════════════════════════════════════════════════════════════════
 * Adaptive Exam Service — Core CAT Intelligence Engine
 * ══════════════════════════════════════════════════════════════════════
 *
 * Handles:
 * 1. Skill DNA profiling from calibration (Part 1) answers
 * 2. Adaptive question generation for Part 2 based on Skill DNA
 * 3. Guess pattern detection
 * 4. Composite forensic ranking calculation
 * 5. Trap question evaluation and skill capping
 */

const QuestionBank = require("../models/QuestionBank");
const {
  generateQualityBatch,
  validateAndFixPositionDistribution,
  tierToDifficulty,
  shuffleArray,
} = require("./questionQualityPipeline");

// ══════════════════════════════════════════════════════════════════════
// SKILL DNA PROFILER
// ══════════════════════════════════════════════════════════════════════

/**
 * Build a Skill DNA fingerprint from Part 1 (calibration) results.
 *
 * For EACH skill, calculates:
 * - accuracy (% correct)
 * - avgResponseMs (average response time)
 * - tier classification (advanced / intermediate / foundational)
 * - guess pattern detection
 * - trap question evaluation (if fell for trap → hard cap at intermediate)
 *
 * @param {Array} calibrationAnswers - [{ questionId, answerIndex, responseTimeMs, changedAnswer }]
 * @param {Array} questions - The calibration question documents (with correctOption, skill, isTrapQuestion, trapBaitIndex)
 * @returns {{ skillDNA: Array, trapResults: Array, guessDetection: object }}
 */
const profileCandidateFromCalibration = (calibrationAnswers, questions) => {
  if (!Array.isArray(calibrationAnswers) || !Array.isArray(questions)) {
    return { skillDNA: [], trapResults: [], guessDetection: { isGuessing: false } };
  }

  // Build a lookup map: questionId → answer data
  const answerMap = new Map();
  calibrationAnswers.forEach((a) => {
    answerMap.set(String(a.questionId), a);
  });

  // Group questions by skill
  const skillGroups = {};
  const trapResults = [];

  questions.forEach((q) => {
    const skill = q.skill || "Technical";
    if (!skillGroups[skill]) {
      skillGroups[skill] = {
        skill,
        totalQuestions: 0,
        correctCount: 0,
        responseTimes: [],
        trapQuestionIds: [],
        trapFailed: false,
      };
    }

    const group = skillGroups[skill];
    group.totalQuestions += 1;

    const answer = answerMap.get(String(q._id));
    const isCorrect = answer && answer.answerIndex === q.correctOption;

    if (isCorrect) {
      group.correctCount += 1;
    }

    if (answer && answer.responseTimeMs) {
      group.responseTimes.push(answer.responseTimeMs);
    }

    // ── Trap question evaluation ──
    if (q.isTrapQuestion) {
      group.trapQuestionIds.push(q._id);
      const fellForTrap = answer && answer.answerIndex === q.trapBaitIndex;

      trapResults.push({
        questionId: q._id,
        skill,
        fellForTrap: Boolean(fellForTrap),
        selectedBaitIndex: answer ? answer.answerIndex : -1,
      });

      if (fellForTrap) {
        group.trapFailed = true;
      }
    }
  });

  // Calculate overall median response time for relative speed comparison
  const allResponseTimes = [];
  Object.values(skillGroups).forEach((g) => {
    allResponseTimes.push(...g.responseTimes);
  });
  const medianResponseMs = calculateMedian(allResponseTimes);

  // Build Skill DNA entries
  const skillDNA = Object.values(skillGroups).map((group) => {
    const accuracy = group.totalQuestions > 0
      ? Math.round((group.correctCount / group.totalQuestions) * 100)
      : 0;

    const avgResponseMs = group.responseTimes.length > 0
      ? Math.round(group.responseTimes.reduce((a, b) => a + b, 0) / group.responseTimes.length)
      : 0;

    // ── Tier classification ──
    let tier = "intermediate";

    // HARD CAP: If candidate fell for a trap question in this skill → cap at intermediate
    if (group.trapFailed) {
      tier = "intermediate";
    } else if (accuracy >= 80 && avgResponseMs > 0 && avgResponseMs < medianResponseMs) {
      // High accuracy + faster than median = advanced
      tier = "advanced";
    } else if (accuracy >= 80) {
      // High accuracy but slow = still advanced (just careful)
      tier = "advanced";
    } else if (accuracy >= 50) {
      tier = "intermediate";
    } else {
      tier = "foundational";
    }

    // ── Guess pattern per skill ──
    const fastResponses = group.responseTimes.filter((t) => t < 4000);
    const guessFlagged = fastResponses.length > group.responseTimes.length * 0.6 && accuracy < 35;

    return {
      skill: group.skill,
      accuracy,
      avgResponseMs,
      totalQuestions: group.totalQuestions,
      correctCount: group.correctCount,
      tier,
      guessFlagged,
      trapCapped: group.trapFailed,
      trapQuestionIds: group.trapQuestionIds,
      trapFailed: group.trapFailed,
    };
  });

  // ── Global guess pattern detection ──
  const guessDetection = detectGuessPattern(
    calibrationAnswers.map((a) => a.responseTimeMs).filter(Boolean),
    calibrationAnswers.map((a) => {
      const q = questions.find((qq) => String(qq._id) === String(a.questionId));
      return q ? a.answerIndex === q.correctOption : false;
    })
  );

  return { skillDNA, trapResults, guessDetection };
};

/**
 * Calculate median of an array.
 */
const calculateMedian = (arr) => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// ══════════════════════════════════════════════════════════════════════
// ADAPTIVE ROUND GENERATION
// ══════════════════════════════════════════════════════════════════════

/**
 * Generate Part 2 (Adaptive Round) questions based on Skill DNA.
 *
 * Rules:
 * - ALL questions MUST be scenario-based (zero conceptual)
 * - Difficulty is calibrated PER SKILL from the Skill DNA
 * - Advanced skills → Hard/Expert questions (tier 4-5)
 * - Intermediate skills → Medium questions (tier 3)
 * - Foundational skills → Easy probing questions (tier 1-2) to find true floor
 *
 * @param {Array} skillDNA - Per-skill proficiency data from profileCandidateFromCalibration
 * @param {Array} jobSkills - Skills required by the job
 * @param {number} questionCount - Total Part 2 questions to generate
 * @param {string} jobDescription - Job description for context
 * @returns {Promise<Array>} Generated Part 2 questions
 */
const generateAdaptiveRound = async (skillDNA, jobSkills = [], questionCount = 10, jobDescription = "") => {
  // Map skill DNA to difficulty tiers
  const skillTierMap = {};
  skillDNA.forEach((entry) => {
    const skillLower = entry.skill.toLowerCase();
    switch (entry.tier) {
      case "advanced":
        skillTierMap[entry.skill] = entry.trapCapped ? 3 : 4; // If trap-capped, don't go above Medium
        break;
      case "intermediate":
        skillTierMap[entry.skill] = 3;
        break;
      case "foundational":
        skillTierMap[entry.skill] = 2; // Easy probing to find true floor
        break;
      default:
        skillTierMap[entry.skill] = 3;
    }
  });

  // If job has skills not in the DNA (candidate didn't see them in calibration), default to Medium
  const allSkills = [...new Set([...Object.keys(skillTierMap), ...jobSkills])];
  allSkills.forEach((s) => {
    if (!skillTierMap[s]) skillTierMap[s] = 3;
  });

  // Distribute questions across skills proportionally
  const skillsToTest = Object.keys(skillTierMap);
  const perSkillCount = Math.max(1, Math.ceil(questionCount / skillsToTest.length));

  const allQuestions = [];
  const usedTexts = new Set();

  for (const skill of skillsToTest) {
    if (allQuestions.length >= questionCount) break;

    const tier = skillTierMap[skill];
    const needed = Math.min(perSkillCount, questionCount - allQuestions.length);

    // Generate quality-assured questions at the mapped difficulty tier
    const batch = await generateQualityBatch(skill, needed, tier, jobDescription);

    for (const q of batch) {
      if (allQuestions.length >= questionCount) break;
      if (!usedTexts.has(q.questionText)) {
        usedTexts.add(q.questionText);
        allQuestions.push({
          ...q,
          phase: "adaptive",
          section: "Adaptive",
        });
      }
    }
  }

  // If we still don't have enough (LLM failures), pull from QuestionBank as fallback
  if (allQuestions.length < questionCount) {
    const remaining = questionCount - allQuestions.length;
    console.log(`[AdaptiveExam] Need ${remaining} more questions. Falling back to QuestionBank.`);

    const fallbackDocs = await QuestionBank.aggregate([
      {
        $match: {
          scenarioType: { $ne: "conceptual" },
          question: { $nin: Array.from(usedTexts) },
        },
      },
      { $sample: { size: remaining } },
    ]);

    for (const doc of fallbackDocs) {
      if (allQuestions.length >= questionCount) break;
      const allOptions = [doc.correct_answer, ...doc.distractors.slice(0, 3)];
      const shuffled = shuffleArray(allOptions);
      allQuestions.push({
        questionText: doc.question,
        options: shuffled,
        correctOption: shuffled.indexOf(doc.correct_answer),
        skill: doc.skillName || "Technical",
        difficulty: doc.difficulty || "Medium",
        difficultyTier: doc.difficultyTier || 3,
        scenarioType: doc.scenarioType || "code_debug",
        codeSnippet: doc.codeSnippet || "",
        codeLanguage: doc.codeLanguage || "",
        section: "Adaptive",
        phase: "adaptive",
      });
    }
  }

  // Final: validate answer position distribution
  const validated = validateAndFixPositionDistribution(allQuestions);

  console.log(`[AdaptiveExam] Generated ${validated.length} adaptive questions across ${skillsToTest.length} skills.`);
  return validated.slice(0, questionCount);
};

// ══════════════════════════════════════════════════════════════════════
// GUESS PATTERN DETECTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Detect systematic guessing based on response timing and accuracy patterns.
 *
 * Flags as guessing if:
 * - >60% of responses are <4 seconds AND accuracy <35%
 *
 * @param {number[]} responseTimes - Array of response times in ms
 * @param {boolean[]} correctness - Array of whether each answer was correct
 * @returns {{ isGuessing: bool, confidence: number, flaggedCount: number }}
 */
const detectGuessPattern = (responseTimes, correctness) => {
  if (!Array.isArray(responseTimes) || responseTimes.length < 5) {
    return { isGuessing: false, confidence: 0, flaggedCount: 0 };
  }

  const fastResponses = responseTimes.filter((t) => t < 4000);
  const fastRatio = fastResponses.length / responseTimes.length;

  const correctCount = correctness.filter(Boolean).length;
  const accuracy = correctCount / correctness.length;

  const isGuessing = fastRatio > 0.6 && accuracy < 0.35;
  const confidence = isGuessing
    ? Math.min(1, (fastRatio - 0.6) * 2.5 + (0.35 - accuracy) * 2)
    : 0;

  return {
    isGuessing,
    confidence: Math.round(confidence * 100) / 100,
    flaggedCount: fastResponses.length,
  };
};

// ══════════════════════════════════════════════════════════════════════
// COMPOSITE FORENSIC RANKING
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculate the composite forensic rank score for a candidate.
 *
 * Formula:
 *   compositeRank = weighted(
 *     calibrationScore * 0.25,
 *     adaptiveScore * 0.35,
 *     skillCeilingScore * 0.15,
 *     consistencyIndex * 0.10,
 *     responseQualityScore * 0.15
 *   ) × trustModifier × integrityModifier × penaltyMultiplier
 *
 * @param {object} params
 * @param {number} params.calibrationScore - Part 1 score (0-100)
 * @param {number} params.adaptiveScore - Part 2 score (0-100), difficulty-weighted
 * @param {Array} params.skillDNA - Per-skill proficiency data
 * @param {number} params.trustScore - Existing VeriProof trust score (0-100)
 * @param {number} params.integrityScore - Proctoring integrity (0-100)
 * @param {Array} params.responseTimings - Per-question response timings
 * @param {Array} params.rankPenalties - Applied penalties
 * @param {boolean} params.partialFinalization - If true, only Part 1 data available
 * @returns {{ adaptiveRankScore, consistencyIndex, responseQualityScore, skillCeiling }}
 */
const calculateCompositeRank = ({
  calibrationScore = 0,
  adaptiveScore = 0,
  skillDNA = [],
  trustScore = 50,
  integrityScore = 100,
  responseTimings = [],
  rankPenalties = [],
  partialFinalization = false,
}) => {
  // ── Skill Ceiling Score: highest proven tier across all skills ──
  const skillCeiling = {};
  let maxCeilingTier = 1;
  skillDNA.forEach((entry) => {
    const tierNum = entry.tier === "advanced" ? 4 : entry.tier === "intermediate" ? 3 : 2;
    skillCeiling[entry.skill] = tierNum;
    if (tierNum > maxCeilingTier) maxCeilingTier = tierNum;
  });
  const skillCeilingScore = Math.min(100, (maxCeilingTier / 5) * 100);

  // ── Consistency Index: how stable is performance across skills ──
  const accuracies = skillDNA.map((e) => e.accuracy);
  let consistencyIndex = 100;
  if (accuracies.length >= 2) {
    const stdDev = Math.sqrt(
      accuracies.reduce((sum, a) => {
        const mean = accuracies.reduce((s, v) => s + v, 0) / accuracies.length;
        return sum + Math.pow(a - mean, 2);
      }, 0) / accuracies.length
    );
    // Lower standard deviation = more consistent = higher index
    consistencyIndex = Math.max(0, Math.min(100, Math.round(100 - stdDev)));
  }

  // ── Response Quality Score: speed + accuracy combo ──
  let responseQualityScore = 50;
  if (responseTimings.length > 0) {
    const validTimings = responseTimings.filter((t) => t.durationMs > 0);
    if (validTimings.length > 0) {
      const avgTime = validTimings.reduce((s, t) => s + t.durationMs, 0) / validTimings.length;
      // Optimal response time is 15-60 seconds. Too fast = guessing, too slow = struggling
      if (avgTime >= 15000 && avgTime <= 60000) {
        responseQualityScore = 85;
      } else if (avgTime > 60000 && avgTime <= 120000) {
        responseQualityScore = 65;
      } else if (avgTime < 15000) {
        responseQualityScore = 30; // Suspiciously fast
      } else {
        responseQualityScore = 40; // Very slow
      }
    }
  }

  // ── Weighted composite score ──
  const effectiveAdaptiveScore = partialFinalization ? 0 : adaptiveScore;

  const rawComposite = partialFinalization
    ? calibrationScore * 0.60 + skillCeilingScore * 0.20 + consistencyIndex * 0.20
    : calibrationScore * 0.25 +
      effectiveAdaptiveScore * 0.35 +
      skillCeilingScore * 0.15 +
      consistencyIndex * 0.10 +
      responseQualityScore * 0.15;

  // ── Apply modifiers ──
  const trustModifier = Math.max(0.5, trustScore / 100);
  const integrityModifier = Math.max(0.0, integrityScore / 100);

  // Calculate cumulative penalty multiplier
  let penaltyMultiplier = 1.0;
  rankPenalties.forEach((penalty) => {
    penaltyMultiplier *= (penalty.penaltyMultiplier || 1.0);
  });

  // Purgatory timeout = devastating 0.3x penalty
  if (partialFinalization) {
    penaltyMultiplier *= 0.3;
  }

  const adaptiveRankScore = Math.max(0, Math.min(100,
    Math.round(rawComposite * trustModifier * integrityModifier * penaltyMultiplier)
  ));

  return {
    adaptiveRankScore,
    consistencyIndex,
    responseQualityScore,
    skillCeiling,
    rawComposite: Math.round(rawComposite),
  };
};

/**
 * Calculate difficulty-weighted score for Part 2 adaptive answers.
 * Expert correct = 4 pts, Hard = 3 pts, Medium = 2 pts, Easy = 1 pt.
 *
 * @param {Array} answers - [{ questionId, answerIndex }]
 * @param {Array} questions - Adaptive question documents
 * @returns {number} Difficulty-weighted score (0-100)
 */
const calculateDifficultyWeightedScore = (answers, questions) => {
  if (!Array.isArray(answers) || !Array.isArray(questions) || questions.length === 0) return 0;

  const answerMap = new Map();
  answers.forEach((a) => answerMap.set(String(a.questionId), a.answerIndex));

  let earnedPoints = 0;
  let maxPoints = 0;

  questions.forEach((q) => {
    const tier = q.difficultyTier || 3;
    const weight = tier >= 5 ? 4 : tier === 4 ? 3 : tier === 3 ? 2 : 1;
    maxPoints += weight;

    const candidateAnswer = answerMap.get(String(q._id));
    if (candidateAnswer === q.correctOption) {
      earnedPoints += weight;
    }
  });

  return maxPoints > 0 ? Math.round((earnedPoints / maxPoints) * 100) : 0;
};

module.exports = {
  profileCandidateFromCalibration,
  generateAdaptiveRound,
  detectGuessPattern,
  calculateCompositeRank,
  calculateDifficultyWeightedScore,
  calculateMedian,
};
