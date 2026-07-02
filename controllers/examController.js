const Question = require("../models/Question");
const User = require("../models/User");
const Project = require("../models/Project");
const VerificationResult = require("../models/VerificationResult");
const crypto = require("crypto");
const { rebuildSkillProgression } = require("../services/skillProgressionService");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const { selectAdaptiveQuestions } = require("../services/claimVerificationService");

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
    const claimedSkills = (analysis?.claims?.skills || []).map((skill) => skill.name);
    const questions = await selectAdaptiveQuestions(claimedSkills, 10);

    if (!questions || questions.length === 0) {
      return res.status(404).json({ message: "No questions available in the database." });
    }

    res.json(questions.map(({ _id, category, difficulty, text, options }) => ({
      _id, category, difficulty, text, options,
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Submit a practice exam payload
// @route   POST /api/exams/submit
// @access  Private
const submitExam = async (req, res) => {
  try {
    // Phase 2C Security: Ensure Repository Analysis is completed before allowing Exam Submission
    const [hasRepoAnalysis, hasResumeAnalysis] = await Promise.all([
      Project.exists({ user: req.user._id, "githubStats.commitsCount": { $exists: true, $gt: 0 } }),
      ResumeAnalysis.exists({ candidateId: req.user._id, active: true, status: "Analysis Complete" }),
    ]);
    if (!hasRepoAnalysis && !hasResumeAnalysis) {
      return res.status(403).json({ message: "Complete resume or repository analysis before the technical assessment." });
    }

    const { answers = [] } = req.body;

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: "Answers are required." });
    }

    const questionIds = answers.map((entry) => entry.questionId).filter(Boolean);
    const questions = await Question.find({ _id: { $in: questionIds } }).select("_id correctIndex");
    const questionMap = new Map(questions.map((question) => [question._id.toString(), question.correctIndex]));

    let correctCount = 0;

    answers.forEach(({ questionId, answerIndex }) => {
      if (questionMap.get(String(questionId)) === answerIndex) {
        correctCount += 1;
      }
    });

    const totalQuestions = answers.length;
    const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const isPassed = score >= 70;

    let certificate = null;
    if (isPassed) {
      const user = await User.findById(req.user._id);
      if (user) {
        const fullQuestions = await Question.find({ _id: { $in: questionIds } }).select("category");
        const categories = [...new Set(fullQuestions.map(q => q.category))];
        
        const certTitle = `${categories[0] || "Software Engineering"} Professional Certificate`;
        const credentialId = `VP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        
        certificate = {
          title: certTitle,
          issuedAt: new Date(),
          issuer: "VeriProof Authority",
          credentialId: credentialId,
          techStack: categories,
          verificationUrl: `/verify-credential/${credentialId}`
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

    const existingResult = await VerificationResult.findOne({ candidateId: req.user._id, status: "Pending Exam" }).sort({ createdAt: -1 });
    if (existingResult) {
      existingResult.examScore = score;
      existingResult.status = isPassed ? "Verified" : "Failed";
      await existingResult.save();
    }

    res.json({
      totalQuestions,
      answeredQuestions: answers.filter(({ answerIndex }) => Number.isInteger(answerIndex)).length,
      correctAnswers: correctCount,
      score,
      status: isPassed ? "Passed" : "Needs Improvement",
      certificate
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  startExam,
  submitExam,
};
