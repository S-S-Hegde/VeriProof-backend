const Question = require("../models/Question");

// @desc    Fetch a generated exam payload
// @route   GET /api/exams/start
// @access  Private
const startExam = async (req, res) => {
  try {
    // In the future, this can query based on req.user.skills
    // For now, randomly select 10 questions across difficulties
    
    const questions = await Question.aggregate([
      { $sample: { size: 10 } },
      { $project: {
          _id: 1,
          category: 1,
          difficulty: 1,
          text: 1,
          options: 1,
      }}
    ]);

    if (!questions || questions.length === 0) {
      return res.status(404).json({ message: "No questions available in the database." });
    }

    res.json(questions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Submit a practice exam payload
// @route   POST /api/exams/submit
// @access  Private
const submitExam = async (req, res) => {
  try {
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

    res.json({
      totalQuestions,
      answeredQuestions: answers.filter(({ answerIndex }) => Number.isInteger(answerIndex)).length,
      correctAnswers: correctCount,
      score,
      status: score >= 70 ? "Passed" : "Needs Improvement",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  startExam,
  submitExam,
};
