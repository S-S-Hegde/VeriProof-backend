const axios = require("axios");
const Exam = require("../models/Exam");
const User = require("../models/User");
const Project = require("../models/Project");
const VerificationResult = require("../models/VerificationResult");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const crypto = require("crypto");
const {
  rebuildSkillProgression,
} = require("../services/skillProgressionService");

const PYTHON_API_BASE = "http://127.0.0.1:8000/api";

// @desc    Fetch a generated exam payload
// @route   GET /api/exams/start
// @access  Private
const startExam = async (req, res) => {
  try {
    const analysis = await ResumeAnalysis.findOne({
      candidateId: req.user._id,
      active: true,
      status: "Analysis Complete",
    });
    const claimedSkills = (analysis?.claims?.skills || []).map(
      (skill) => skill.name,
    );
    const formattedClaims = claimedSkills.map((skill) => ({
      skill,
      context: "Practice Assessment",
    }));

    // 1. Generate Assessment via Python AI Engine
    const pythonRes = await axios.post(
      `${PYTHON_API_BASE}/generate-assessment`,
      {
        claims:
          formattedClaims.length > 0
            ? formattedClaims
            : [{ skill: "Software Engineering", context: "General" }],
        difficulty: "intermediate",
      },
    );
    const generatedMcqs = pythonRes.data.result.mcq_questions || [];

    if (!generatedMcqs.length) {
      return res
        .status(404)
        .json({ message: "AI Engine failed to generate questions." });
    }

    // 2. Save to the Exam collection to grade against later
    const exam = await Exam.create({
      candidateId: req.user._id,
      topic: "Dynamic Practice Exam",
      skills: claimedSkills,
      passingScore: 70,
      questions: generatedMcqs.map((q) => {
        const correctIdx = q.options.indexOf(q.correct_answer);
        return {
          questionText: q.question_text,
          options: q.options,
          correctOption: correctIdx !== -1 ? correctIdx : 0,
        };
      }),
    });

    // 3. Format for the frontend UI
    const frontendQuestions = exam.questions.map((q) => ({
      _id: q._id,
      category: claimedSkills[0] || "General",
      difficulty: "Medium",
      text: q.questionText,
      options: q.options,
    }));

    res.json(frontendQuestions);
  } catch (error) {
    console.error("[Python Proxy] Start Exam Error:", error.message);
    res.status(500).json({ message: "Failed to connect to AI Engine." });
  }
};

// @desc    Submit a practice exam payload
// @route   POST /api/exams/submit
// @access  Private
const submitExam = async (req, res) => {
  try {
    // Ensure basic profile readiness
    const [hasRepoAnalysis, hasResumeAnalysis] = await Promise.all([
      Project.exists({
        user: req.user._id,
        "githubStats.commitsCount": { $exists: true, $gt: 0 },
      }),
      ResumeAnalysis.exists({
        candidateId: req.user._id,
        active: true,
        status: "Analysis Complete",
      }),
    ]);
    if (!hasRepoAnalysis && !hasResumeAnalysis) {
      return res
        .status(403)
        .json({
          message:
            "Complete resume or repository analysis before the technical assessment.",
        });
    }

    const { answers = [], code_snippet, behavioral_response } = req.body;

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: "Answers are required." });
    }

    // Lookup the dynamically generated exam
    const questionIds = answers
      .map((entry) => entry.questionId)
      .filter(Boolean);
    const exam = await Exam.findOne({ "questions._id": { $in: questionIds } });

    let correctCount = 0;
    let totalQuestions = answers.length;

    if (exam) {
      const questionMap = new Map(
        exam.questions.map((q) => [q._id.toString(), q.correctOption]),
      );
      answers.forEach(({ questionId, answerIndex }) => {
        if (questionMap.get(String(questionId)) === answerIndex) {
          correctCount += 1;
        }
      });
    }

    let score =
      totalQuestions > 0
        ? Math.round((correctCount / totalQuestions) * 100)
        : 0;

    // --- PROXY TO PYTHON: Grade Code Snippets ---
    if (code_snippet) {
      try {
        const codeRes = await axios.post(`${PYTHON_API_BASE}/grade-code`, {
          code_snippet,
          language: "javascript",
          problem_context: "Practice Assessment",
        });
        const codeScore = codeRes.data.result.score || 0;
        score = Math.round((score + codeScore) / 2); // Average the scores
      } catch (err) {
        console.error("[Python Proxy] Code Grading Failed:", err.message);
      }
    }

    // --- PROXY TO PYTHON: Grade Behavioral Answers ---
    if (behavioral_response) {
      try {
        const behavRes = await axios.post(
          `${PYTHON_API_BASE}/evaluate-behavioral`,
          {
            response_text: behavioral_response,
            question_context: "Describe a challenging problem you solved.",
          },
        );
        const behavScore = behavRes.data.result.score || 0;
        score = Math.round((score + behavScore) / 2); // Average the scores
      } catch (err) {
        console.error(
          "[Python Proxy] Behavioral Evaluation Failed:",
          err.message,
        );
      }
    }

    const isPassed = score >= 70;
    let certificate = null;

    if (isPassed) {
      const user = await User.findById(req.user._id);
      if (user) {
        const categories = exam ? exam.skills : ["Software Engineering"];
        const certTitle = `${categories[0] || "Software Engineering"} Professional Certificate`;
        const credentialId = `VP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

        certificate = {
          title: certTitle,
          issuedAt: new Date(),
          issuer: "VeriProof Authority",
          credentialId: credentialId,
          techStack: categories,
          verificationUrl: `/verify-credential/${credentialId}`,
        };

        user.certificates.push(certificate);
        await user.save();
        await rebuildSkillProgression(user._id, {
          type: "exam",
          label: certTitle,
          technologies: categories,
          score,
          xp: 160,
          completed: true,
          source: credentialId,
        });
      }
    }

    if (exam) {
      exam.status = "Completed";
      exam.score = score;
      exam.timeTaken = 30;
      exam.codeQuality = score;
      exam.answers = answers;
      await exam.save();
    }

    const existingResult = await VerificationResult.findOne({
      candidateId: req.user._id,
      status: "Pending Exam",
    }).sort({ createdAt: -1 });
    if (existingResult) {
      existingResult.examScore = score;
      existingResult.status = isPassed ? "Verified" : "Failed";
      await existingResult.save();
    }

    res.json({
      totalQuestions,
      answeredQuestions: answers.filter(({ answerIndex }) =>
        Number.isInteger(answerIndex),
      ).length,
      correctAnswers: correctCount,
      score,
      status: isPassed ? "Passed" : "Needs Improvement",
      certificate,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  startExam,
  submitExam,
};
