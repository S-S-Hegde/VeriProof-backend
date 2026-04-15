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
          category: 1,
          difficulty: 1,
          text: 1,
          options: 1,
          // Exclude correctIndex if we want strict security, 
          // but for this implementation we pass it for client-side scoring
          correctIndex: 1
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

module.exports = {
  startExam
};
