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
    let generatedMcqs = [];
    try {
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
      generatedMcqs = pythonRes.data.result?.mcq_questions || [];
    } catch (err) {
      console.warn(
        "[Python Proxy] Start Exam Error (using 30-question catalog fallback):",
        err.message,
      );
    }

    // Fallback: If Python AI engine is offline or returns empty, use 30-question catalog
    if (!generatedMcqs || generatedMcqs.length === 0) {
      generatedMcqs = get30QuestionCatalog(claimedSkills);
    }

    // 2. Save to the Exam collection to grade against later
    const exam = await Exam.create({
      candidateId: req.user._id,
      topic: "Dynamic Practice Exam",
      skills:
        claimedSkills.length > 0
          ? claimedSkills
          : ["Python", "SQL", "React", "Node.js", "MongoDB", "Git"],
      passingScore: 70,
      questions: generatedMcqs.map((q) => {
        const correctIdx = q.options.indexOf(
          q.correct_answer || q.correctAnswer,
        );
        return {
          questionText: q.question_text || q.question,
          options: q.options,
          correctOption: correctIdx !== -1 ? correctIdx : 0,
          skill: q.skill || q.category || "Technical",
        };
      }),
    });

    // 3. Format for the frontend UI
    const frontendQuestions = exam.questions.map((q, idx) => ({
      _id: q._id,
      category: q.skill || claimedSkills[0] || "General",
      difficulty: "Medium",
      text: q.questionText,
      options: q.options,
    }));

    res.json(frontendQuestions);
  } catch (error) {
    console.error("Start Exam Error:", error.message);
    res.status(500).json({ message: "Failed to generate exam questions." });
  }
};

// 30-Question Catalog Fallback Helper
const get30QuestionCatalog = (skills) => [
  {
    question:
      "What is the primary difference between a List and a Tuple in Python?",
    options: [
      "Lists are immutable, Tuples are mutable",
      "Lists are mutable, Tuples are immutable",
      "Tuples cannot store integers",
      "Lists require string keys",
    ],
    correctAnswer: "Lists are mutable, Tuples are immutable",
    skill: "Python",
  },
  {
    question: "Which keyword is used for exception handling cleanup in Python?",
    options: ["finally", "catch", "defer", "finish"],
    correctAnswer: "finally",
    skill: "Python",
  },
  {
    question: "What does the `__init__` method represent in Python classes?",
    options: [
      "Destructor",
      "Constructor",
      "Module Loader",
      "Static Initializer",
    ],
    correctAnswer: "Constructor",
    skill: "Python",
  },
  {
    question: "Which built-in module is used to handle JSON data in Python?",
    options: ["json", "pyjson", "serialize", "jackson"],
    correctAnswer: "json",
    skill: "Python",
  },
  {
    question: "What is the output of `len({1, 2, 2, 3})` in Python?",
    options: ["4", "3", "2", "Error"],
    correctAnswer: "3",
    skill: "Python",
  },

  {
    question: "Which SQL clause is used to filter aggregate query results?",
    options: ["WHERE", "HAVING", "GROUP BY", "ORDER BY"],
    correctAnswer: "HAVING",
    skill: "SQL",
  },
  {
    question:
      "Which JOIN returns all records from the left table and matched records from the right table?",
    options: ["INNER JOIN", "RIGHT JOIN", "LEFT JOIN", "FULL OUTER JOIN"],
    correctAnswer: "LEFT JOIN",
    skill: "SQL",
  },
  {
    question:
      "Which SQL constraint ensures all values in a column are distinct?",
    options: ["FOREIGN KEY", "UNIQUE", "NOT NULL", "CHECK"],
    correctAnswer: "UNIQUE",
    skill: "SQL",
  },
  {
    question: "What is the purpose of an INDEX in a database table?",
    options: [
      "Encrypt data",
      "Speed up data retrieval",
      "Enforce foreign keys",
      "Create table backups",
    ],
    correctAnswer: "Speed up data retrieval",
    skill: "SQL",
  },
  {
    question:
      "Which SQL statement is used to remove a table and its structure permanently?",
    options: ["DELETE TABLE", "DROP TABLE", "REMOVE TABLE", "TRUNCATE TABLE"],
    correctAnswer: "DROP TABLE",
    skill: "SQL",
  },

  {
    question:
      "Which hook is used to perform side effects in React functional components?",
    options: ["useState", "useMemo", "useEffect", "useCallback"],
    correctAnswer: "useEffect",
    skill: "React",
  },
  {
    question: "What is the Virtual DOM in React?",
    options: [
      "A lightweight in-memory representation of the real DOM",
      "A physical server component",
      "A replacement for HTML",
      "A browser extension",
    ],
    correctAnswer: "A lightweight in-memory representation of the real DOM",
    skill: "React",
  },
  {
    question:
      "How do you pass data down from a parent to a child component in React?",
    options: ["Props", "State", "Hooks", "Reducers"],
    correctAnswer: "Props",
    skill: "React",
  },
  {
    question: "What happens when a React component's state updates?",
    options: [
      "Page reloads",
      "Component re-renders",
      "Browser crashes",
      "State resets",
    ],
    correctAnswer: "Component re-renders",
    skill: "React",
  },
  {
    question:
      "Which hook should be used to optimize expensive computational functions?",
    options: ["useMemo", "useState", "useRef", "useContext"],
    correctAnswer: "useMemo",
    skill: "React",
  },

  {
    question: "What architecture pattern does Node.js use for concurrency?",
    options: [
      "Multi-threaded synchronous",
      "Single-threaded non-blocking Event Loop",
      "Process per request",
      "Shared memory concurrency",
    ],
    correctAnswer: "Single-threaded non-blocking Event Loop",
    skill: "Node.js",
  },
  {
    question: "Which core module is used to work with file paths in Node.js?",
    options: ["fs", "path", "url", "os"],
    correctAnswer: "path",
    skill: "Node.js",
  },
  {
    question: "What is `npm` in the Node.js ecosystem?",
    options: [
      "Node Performance Monitor",
      "Node Package Manager",
      "Node Process Model",
      "Network Protocol Method",
    ],
    correctAnswer: "Node Package Manager",
    skill: "Node.js",
  },
  {
    question:
      "Which mechanism is used in Express.js to process HTTP requests sequentially?",
    options: ["Middleware", "Streams", "Workers", "Sockets"],
    correctAnswer: "Middleware",
    skill: "Node.js",
  },
  {
    question: "Which built-in module allows creating HTTP servers in Node.js?",
    options: ["net", "http", "express", "server"],
    correctAnswer: "http",
    skill: "Node.js",
  },

  {
    question: "What format does MongoDB use to store data internally?",
    options: ["JSON", "BSON", "XML", "CSV"],
    correctAnswer: "BSON",
    skill: "MongoDB",
  },
  {
    question: "What is a document in MongoDB analogous to in a Relational DB?",
    options: ["Database", "Table", "Row", "Column"],
    correctAnswer: "Row",
    skill: "MongoDB",
  },
  {
    question:
      "Which command is used to query documents in a MongoDB collection?",
    options: ["find()", "select()", "fetch()", "query()"],
    correctAnswer: "find()",
    skill: "MongoDB",
  },
  {
    question:
      "What is the primary key field created automatically by MongoDB for every document?",
    options: ["id", "_id", "doc_id", "pk"],
    correctAnswer: "_id",
    skill: "MongoDB",
  },
  {
    question:
      "Which pipeline framework is used for advanced multi-stage data processing in MongoDB?",
    options: [
      "MapReduce",
      "Aggregation Pipeline",
      "Query Builder",
      "Stream Process",
    ],
    correctAnswer: "Aggregation Pipeline",
    skill: "MongoDB",
  },

  {
    question:
      "Which command is used to record staged changes into the local repository history?",
    options: ["git push", "git save", "git commit", "git add"],
    correctAnswer: "git commit",
    skill: "Git",
  },
  {
    question:
      "Which command creates a new Git branch and switches to it immediately?",
    options: [
      "git branch -new",
      "git checkout -b",
      "git switch -create",
      "git init",
    ],
    correctAnswer: "git checkout -b",
    skill: "Git",
  },
  {
    question: "What does `git fetch` do?",
    options: [
      "Downloads remote commits without merging",
      "Deletes uncommitted files",
      "Creates a pull request",
      "Reverts last commit",
    ],
    correctAnswer: "Downloads remote commits without merging",
    skill: "Git",
  },
  {
    question:
      "Which file is used to specify intentionally untracked files that Git should ignore?",
    options: [".gitconfig", ".gitignore", ".gitkeep", ".env"],
    correctAnswer: ".gitignore",
    skill: "Git",
  },
  {
    question: "Which command combines changes from one branch into another?",
    options: ["git merge", "git combine", "git join", "git push"],
    correctAnswer: "git merge",
    skill: "Git",
  },
];

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
      return res.status(403).json({
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
