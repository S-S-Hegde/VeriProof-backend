const axios = require("axios");
const Exam = require("../models/Exam");
const User = require("../models/User");
const Project = require("../models/Project");
const VerificationResult = require("../models/VerificationResult");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const {
  rebuildSkillProgression,
} = require("../services/skillProgressionService");

const PYTHON_API_BASE = process.env.AI_ENGINE_URL || "https://python-engine-adw8.onrender.com";

// Helper to shuffle array with Fisher-Yates
const shuffle = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// ── Dynamic Algorithmic Question Generator ─────────────────────
const generateDynamicAlgorithmicQuestions = (skills = [], difficulty = "intermediate") => {
  const fullBank = [
    // Python
    { question: "What is the primary difference between a List and a Tuple in Python?", options: ["Lists are mutable, Tuples are immutable", "Lists are immutable, Tuples are mutable", "Tuples cannot store integers", "Lists require string keys"], correctAnswer: "Lists are mutable, Tuples are immutable", skill: "Python", difficulty: "Easy" },
    { question: "Which keyword is used for exception handling cleanup in Python?", options: ["finally", "catch", "defer", "finish"], correctAnswer: "finally", skill: "Python", difficulty: "Easy" },
    { question: "What does the `__init__` method represent in Python classes?", options: ["Constructor", "Destructor", "Module Loader", "Static Initializer"], correctAnswer: "Constructor", skill: "Python", difficulty: "Easy" },
    { question: "Which built-in module is used to handle JSON serialization in Python?", options: ["json", "pyjson", "serialize", "jackson"], correctAnswer: "json", skill: "Python", difficulty: "Easy" },
    { question: "What is the computational complexity of average lookup in a Python dictionary?", options: ["O(1)", "O(n)", "O(log n)", "O(n^2)"], correctAnswer: "O(1)", skill: "Python", difficulty: "Medium" },
    { question: "What does the `@staticmethod` decorator do in Python?", options: ["Defines a method that does not access instance or class state", "Makes the method private", "Forces synchronous execution", "Overrides parent implementation"], correctAnswer: "Defines a method that does not access instance or class state", skill: "Python", difficulty: "Medium" },
    { question: "How does Python manage automatic memory allocation and deallocation?", options: ["Reference counting combined with a generational garbage collector", "Manual malloc and free", "Immediate stack deallocation only", "Compile-time static layout"], correctAnswer: "Reference counting combined with a generational garbage collector", skill: "Python", difficulty: "Hard" },

    // JavaScript & TypeScript
    { question: "What is the event loop in JavaScript primarily responsible for?", options: ["Handling asynchronous callbacks by monitoring the call stack and task queue", "Compiling JS to bytecode", "Managing CPU thread scheduling", "Parsing HTML tags"], correctAnswer: "Handling asynchronous callbacks by monitoring the call stack and task queue", skill: "JavaScript", difficulty: "Medium" },
    { question: "What is the difference between `==` and `===` in JavaScript?", options: ["`===` compares both value and type without type coercion", "`==` is strict equality", "There is no difference", "`===` only works for numbers"], correctAnswer: "`===` compares both value and type without type coercion", skill: "JavaScript", difficulty: "Easy" },
    { question: "Which method creates a new array populated with the results of calling a provided function on every element?", options: ["Array.prototype.map()", "Array.prototype.forEach()", "Array.prototype.filter()", "Array.prototype.reduce()"], correctAnswer: "Array.prototype.map()", skill: "JavaScript", difficulty: "Easy" },
    { question: "What is a closure in JavaScript?", options: ["A function bundled with references to its lexical surrounding state", "A function that has no return statement", "A private class constructor", "A self-terminating loop"], correctAnswer: "A function bundled with references to its lexical surrounding state", skill: "JavaScript", difficulty: "Medium" },
    { question: "In TypeScript, what does the `unknown` type represent compared to `any`?", options: ["A type-safe counterpart where operations require type narrowing or assertions", "An alias for undefined", "A type that allows arbitrary method calls without checks", "A void return value"], correctAnswer: "A type-safe counterpart where operations require type narrowing or assertions", skill: "TypeScript", difficulty: "Hard" },
    { question: "What is the difference between `type` and `interface` in TypeScript?", options: ["Interfaces can be merged with declaration merging, types cannot", "Types can only represent primitives", "Interfaces cannot extend each other", "There are no functional differences"], correctAnswer: "Interfaces can be merged with declaration merging, types cannot", skill: "TypeScript", difficulty: "Medium" },

    // React
    { question: "Which React hook is used to perform side effects in functional components?", options: ["useEffect", "useState", "useMemo", "useCallback"], correctAnswer: "useEffect", skill: "React", difficulty: "Easy" },
    { question: "What is the primary benefit of `useMemo` in React?", options: ["Memoizing the calculated result of expensive operations between re-renders", "Persisting state to local storage", "Creating DOM references", "Subscribing to WebSocket events"], correctAnswer: "Memoizing the calculated result of expensive operations between re-renders", skill: "React", difficulty: "Medium" },
    { question: "What is the role of the `key` prop when rendering lists in React?", options: ["Helps React identify which items have changed, been added, or been removed", "Provides CSS styling IDs", "Encrypts child components", "Registers browser focus"], correctAnswer: "Helps React identify which items have changed, been added, or been removed", skill: "React", difficulty: "Easy" },
    { question: "What is React Fiber?", options: ["A reimplementation of React's core reconciliation algorithm for incremental rendering", "A CSS framework for React", "A state management library", "A server runtime"], correctAnswer: "A reimplementation of React's core reconciliation algorithm for incremental rendering", skill: "React", difficulty: "Hard" },
    { question: "When should you use `useCallback` instead of `useMemo` in React?", options: ["To memoize a callback function instance between renders", "To memoize JSX DOM nodes", "To trigger re-renders", "To fetch data from REST APIs"], correctAnswer: "To memoize a callback function instance between renders", skill: "React", difficulty: "Medium" },

    // Node.js & Express
    { question: "How does Node.js achieve non-blocking I/O operations despite being single-threaded?", options: ["By delegating I/O operations to libuv's background worker thread pool and OS kernel", "By launching child processes for every request", "By using multi-threaded JavaScript execution", "By pausing the main thread"], correctAnswer: "By delegating I/O operations to libuv's background worker thread pool and OS kernel", skill: "Node.js", difficulty: "Medium" },
    { question: "In Express.js middleware, what happens if you forget to call `next()`?", options: ["The request will hang indefinitely and time out", "An unhandled exception is thrown", "Express sends an automatic 200 OK", "The server crashes"], correctAnswer: "The request will hang indefinitely and time out", skill: "Node.js", difficulty: "Easy" },
    { question: "What is the purpose of `process.nextTick()` in Node.js?", options: ["Schedules a callback to be invoked at the end of the current operation, before the next event loop tick", "Delays execution by 1 millisecond", "Schedules work on a separate CPU core", "Cancels scheduled promises"], correctAnswer: "Schedules a callback to be invoked at the end of the current operation, before the next event loop tick", skill: "Node.js", difficulty: "Hard" },
    { question: "Which Node.js core module provides stream and buffer utilities for handling large binary files?", options: ["stream", "file", "disk", "binary"], correctAnswer: "stream", skill: "Node.js", difficulty: "Medium" },

    // SQL & Databases
    { question: "Which SQL clause is used to filter aggregate query results?", options: ["HAVING", "WHERE", "GROUP BY", "ORDER BY"], correctAnswer: "HAVING", skill: "SQL", difficulty: "Easy" },
    { question: "Which JOIN returns all records from the left table and matched records from the right table?", options: ["LEFT JOIN", "INNER JOIN", "RIGHT JOIN", "FULL OUTER JOIN"], correctAnswer: "LEFT JOIN", skill: "SQL", difficulty: "Easy" },
    { question: "What is the main benefit of a Database Index (B-Tree)?", options: ["Speeds up search and retrieval queries at the cost of slower writes and additional storage", "Compresses stored table rows", "Enforces foreign key relationships", "Automatically backups data"], correctAnswer: "Speeds up search and retrieval queries at the cost of slower writes and additional storage", skill: "SQL", difficulty: "Medium" },
    { question: "What does ACID stand for in database transaction management?", options: ["Atomicity, Consistency, Isolation, Durability", "Accuracy, Control, Indexing, Delivery", "Authentication, Cryptography, Integrity, Decryption", "Allocation, Concurrency, Iteration, Deletion"], correctAnswer: "Atomicity, Consistency, Isolation, Durability", skill: "SQL", difficulty: "Easy" },
    { question: "In MongoDB, what is the Aggregation Pipeline used for?", options: ["Multi-stage document transformation, grouping, filtering, and statistical computation", "Managing cluster user logins", "Replicating data across regions", "Generating schema migrations"], correctAnswer: "Multi-stage document transformation, grouping, filtering, and statistical computation", skill: "MongoDB", difficulty: "Medium" },
    { question: "What is an Inverted Index primarily used for in databases like Elasticsearch?", options: ["Fast full-text search by mapping words to their document locations", "Storing relational foreign keys", "Encrypting passwords", "Balancing CPU loads"], correctAnswer: "Fast full-text search by mapping words to their document locations", skill: "Databases", difficulty: "Hard" },

    // Cloud, Caching & DevOps
    { question: "What is Redis primarily utilized for in high-concurrency web systems?", options: ["In-memory caching, pub/sub messaging, and distributed session storage", "Relational ACID backups", "Parsing client-side CSS", "Compiling Go binaries"], correctAnswer: "In-memory caching, pub/sub messaging, and distributed session storage", skill: "Redis", difficulty: "Medium" },
    { question: "What is the primary role of a Reverse Proxy (such as NGINX)?", options: ["Directing client requests to backend servers, handling SSL termination, and caching", "Rendering browser HTML", "Managing local Git branches", "Compiling client JavaScript"], correctAnswer: "Directing client requests to backend servers, handling SSL termination, and caching", skill: "Architecture", difficulty: "Easy" },
    { question: "Which Git command is used to integrate commits from one branch by reapplying them on top of another base tip?", options: ["git rebase", "git merge", "git cherry-pick", "git branch"], correctAnswer: "git rebase", skill: "Git", difficulty: "Medium" },
    { question: "What is the main purpose of Docker containerization?", options: ["Packaging an application and its dependencies into a lightweight, reproducible executable environment", "Virtualizing complete physical hardware", "Managing relational database transactions", "Formatting source code"], correctAnswer: "Packaging an application and its dependencies into a lightweight, reproducible executable environment", skill: "DevOps", difficulty: "Easy" },
    { question: "In RESTful API design, which HTTP method is considered idempotent for replacing a complete resource representation?", options: ["PUT", "POST", "PATCH", "CONNECT"], correctAnswer: "PUT", skill: "API Design", difficulty: "Easy" },
    { question: "What is the CAP Theorem trade-off in distributed data stores?", options: ["A distributed system can guarantee at most two out of Consistency, Availability, and Partition Tolerance", "Computers must balance CPU, Architecture, and Performance", "Code, Accuracy, and Precision must be equal", "Concurrency, Allocation, and Persistence"], correctAnswer: "A distributed system can guarantee at most two out of Consistency, Availability, and Partition Tolerance", skill: "Architecture", difficulty: "Hard" },
    { question: "What is the primary advantage of WebSockets over standard HTTP polling?", options: ["Full-duplex, persistent bi-directional communication over a single TCP connection", "Automatic encryption", "Faster TLS handshakes", "Stateless response headers"], correctAnswer: "Full-duplex, persistent bi-directional communication over a single TCP connection", skill: "WebSockets", difficulty: "Medium" },
    { question: "How does JWT (JSON Web Token) authentication provide statelessness?", options: ["The server cryptographically verifies the signed token payload without database lookups", "The server stores session IDs in RAM", "Tokens are stored in cookies only", "The client encrypts the database credentials"], correctAnswer: "The server cryptographically verifies the signed token payload without database lookups", skill: "Security", difficulty: "Medium" },
    { question: "In Kubernetes, what is the smallest deployable computing unit?", options: ["Pod", "Node", "Cluster", "Service"], correctAnswer: "Pod", skill: "DevOps", difficulty: "Medium" },
    { question: "What is the purpose of Database Connection Pooling?", options: ["Reusing an active pool of database connections to eliminate the overhead of repeated TCP/TLS handshakes", "Backing up table schemas", "Encrypting database disk storage", "Generating SQL migrations automatically"], correctAnswer: "Reusing an active pool of database connections to eliminate the overhead of repeated TCP/TLS handshakes", skill: "Architecture", difficulty: "Hard" },
  ];

  const normalizedCandidateSkills = (skills || []).map(s => s.toLowerCase());
  const matchedPool = fullBank.filter(q =>
    normalizedCandidateSkills.some(cs => cs.includes(q.skill.toLowerCase()) || q.skill.toLowerCase().includes(cs))
  );
  const otherPool = fullBank.filter(q => !matchedPool.includes(q));

  const combinedSelection = [...shuffle(matchedPool), ...shuffle(otherPool)];
  const selectedQuestions = combinedSelection.slice(0, 35);

  return selectedQuestions.map((q) => {
    const shuffledOptions = shuffle(q.options);
    return {
      question_text: q.question,
      options: shuffledOptions,
      correct_answer: q.correctAnswer,
      skill: q.skill,
      difficulty: q.difficulty || "Medium"
    };
  });
};

// @desc    Fetch a generated exam payload
// @route   GET /api/exams/start
// @access  Private
const startExam = async (req, res) => {
  try {
    const InvitationRegistry = require("../models/InvitationRegistry");
    const RecruiterApplicant = require("../models/RecruiterApplicant");
    const Job = require("../models/Job");

    const isInvitedCandidate = req.user.origin === "recruiter_invited";

    // ── STRICT SECURITY GUARD: Check for previous proctoring violations ──
    const violatedExam = await Exam.findOne({
      candidateId: req.user._id,
      status: { $in: ["Terminated", "Violated", "Disqualified"] }
    });

    const violatedApplicant = await RecruiterApplicant.findOne({
      $or: [
        { candidateUser: req.user._id },
        { extractedEmail: req.user.email },
        { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
      ],
      examStatus: { $in: ["Violated", "Terminated", "Disqualified", "Terminated - Proctoring Violation"] }
    });

    // If violated/disqualified, strictly forbid any future attempts
    if (violatedExam || violatedApplicant) {
      return res.status(403).json({
        completed: true,
        disqualified: true,
        message: "DISQUALIFIED_DUE_TO_VIOLATIONS",
        error: "You have been disqualified from this assessment due to security and proctoring violations. Retakes are strictly prohibited.",
      });
    }

    // ── Resolve invitation + applicant record ──────────────────────────
    const invitation = await InvitationRegistry.findOne({
      $or: [
        { email: req.user.email },
        { email: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
      ]
    });

    let applicant = null;
    if (invitation) {
      applicant = await RecruiterApplicant.findOne({
        recruiterId: invitation.recruiterId,
        jobId: invitation.jobId,
        $or: [
          { candidateUser: req.user._id },
          { extractedEmail: req.user.email },
          { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
        ]
      });
    }

    // Fallback: find any applicant linked directly to this user
    if (!applicant && isInvitedCandidate) {
      applicant = await RecruiterApplicant.findOne({
        $or: [
          { candidateUser: req.user._id },
          { extractedEmail: req.user.email },
          { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
        ]
      }).sort({ createdAt: -1 });
    }

    // ── Resolve job context ────────────────────────────────────────────
    let jobTargetSkills = [];
    let jobDifficulty = "intermediate";
    let jobTitle = "Senior Full Stack Software Engineer";
    let jobDescription = "Design, develop, and test scalable web applications and APIs.";

    const jobId = invitation?.jobId || applicant?.jobId || null;
    if (jobId) {
      const job = await Job.findById(jobId);
      if (job) {
        jobTargetSkills = (job.targetSkills || []).map(s => (typeof s === "string" ? s : s.skill || "")).filter(Boolean);
        jobDifficulty = job.difficulty || "intermediate";
        if (job.title) jobTitle = job.title;
        if (job.description) jobDescription = job.description;
      }
    }

    // ── Resolve resume analysis (ResumeAnalysis or applicant record) ──
    const analysis = await ResumeAnalysis.findOne({
      candidateId: req.user._id,
      active: true,
      status: "Analysis Complete",
    });

    // Build resume text — prefer ResumeAnalysis, fall back to applicant raw text
    const resumeText = analysis?.analysis?.summary
      || analysis?.claims?.summary
      || applicant?.resumeText
      || "";

    // ── Skill resolution: job skills ∪ resume/applicant skills ─────────
    const analysisSkills = (analysis?.claims?.skills || []).map(
      s => (typeof s === "string" ? s : s.name || s.skill || "")
    ).filter(Boolean);

    const applicantSkills = (applicant?.matchedSkills || applicant?.claimedSkills || []).map(
      s => (typeof s === "string" ? s : s.name || s.skill || "")
    ).filter(Boolean);

    const claimedSkills = analysisSkills.length > 0 ? analysisSkills : applicantSkills;
    const combinedSkills = [...new Set([...jobTargetSkills, ...claimedSkills])];

    // Ensure invited candidates always have at least the job skills to generate questions from
    const effectiveSkills = combinedSkills.length > 0
      ? combinedSkills
      : isInvitedCandidate
        ? ["Software Engineering", "Full Stack Development", "API Design", "Databases"]
        : ["Python", "SQL", "React", "Node.js", "MongoDB", "Git"];

    const formattedClaims = effectiveSkills.map((skill) => ({
      skill,
      context: (invitation || applicant) ? `Job Alignment Assessment (${jobTitle})` : "Practice Assessment",
    }));

    // ── Multi-Provider AI Question Generation Engine ───────────────────
    let generatedMcqs = [];

    const systemPrompt = `You are a Principal Staff Engineer, IIT/NPTEL Examination Chair, and Senior Technical Evaluator designing an elite, rigorous proctored technical assessment for the role: "${jobTitle}".

── JOB CONTEXT & TECHNICAL STACK ──
Job Description: "${jobDescription || "Design, develop, scale, and maintain high-performance software systems and APIs."}"
Required Core Competencies: ${jobTargetSkills.join(", ") || effectiveSkills.join(", ")}
Candidate Verified Competencies: ${effectiveSkills.join(", ")}
Target Seniority Level: "${jobDifficulty}"

── STRICT OPTION SYMMETRY & ANTI-BIAS RULES (CRITICAL) ──
1. EQUAL OPTION LENGTH: All 4 options (A, B, C, D) must have SIMILAR word counts and grammatical structures. DO NOT make the correct answer longer, more detailed, or more qualified than distractor options. Avoid the "longest option is correct" giveaway.
2. PLAUSIBLE DISTRACTORS: Every incorrect option must be an authentic, intelligent developer trap (e.g., off-by-one errors, shallow vs deep copy pitfalls, event loop microtask vs macrotask execution order, NULL comparison anomalies in SQL, stale closure state).

── QUESTION ARCHITECTURE & NPTEL/LEETCODE STYLES ──
Adopt the analytical rigor of LeetCode / HackerRank / NPTEL examination problems:
• STYLE A: "Code Output & Execution Trace" — Multi-line code snippets testing closures, async/await event loops, recursion, mutation, and edge cases.
• STYLE B: "Multi-Statement Evaluation (NPTEL Style)" — Present a scenario followed by 3 statements (I, II, III) and ask which are True/False:
  e.g., "(A) I and II only", "(B) II and III only", "(C) I and III only", "(D) I, II, and III".
• STYLE C: "Time/Space Complexity & Algorithmic Trade-offs" — Deep asymptotic analysis of data structure operations and caching strategies.
• STYLE D: "High-Concurrency & Distributed Architecture" — Diagnosing race conditions, deadlocks, partition tolerance, and database transaction isolation levels.

── PROGRESSIVE 3-TIER DIFFICULTY BREAKDOWN (35 QUESTIONS TOTAL) ──
• Tier 1 (Questions 1 to 10) — "Easy": Focused 3-6 line code snippets, syntax precision, edge-case evaluations, and fundamental APIs.
• Tier 2 (Questions 11 to 25) — "Medium": Multi-step code traces, async ordering, SQL CTE/window functions, and state mutation diagnostics requiring 1-2 minutes of analysis.
• Tier 3 (Questions 26 to 35) — "Hard": Complex NPTEL-style multi-statement evaluations, distributed system failure modes, caching invalidation anomalies, and high-concurrency race condition scenarios.

Return ONLY a valid JSON array without any markdown formatting, backticks, or extra text:
[
  {
    "question": "Rigorous scenario or code snippet question text",
    "options": ["Option A (concise, uniform length)", "Option B (concise, uniform length)", "Option C (concise, uniform length)", "Option D (concise, uniform length)"],
    "correct_answer": "Exact string of correct option",
    "skill": "Specific skill name from JD",
    "difficulty": "Easy" | "Medium" | "Hard"
  }
]`;

    // 1. Primary Provider: Groq Cloud (Ultra-Fast Llama-3.3 70B Versatile)
    if (!generatedMcqs || generatedMcqs.length === 0) {
      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        try {
          const groqRes = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model: "llama-3.3-70b-versatile",
              messages: [
                { role: "system", content: "You are an expert technical interviewer that outputs raw JSON only." },
                { role: "user", content: systemPrompt }
              ],
              temperature: 0.7,
            },
            {
              headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
              timeout: 10000
            }
          );
          const rawContent = (groqRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(rawContent);
          const questionsList = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.mcqs || parsed.mcq_questions || []);
          if (questionsList.length >= 5) {
            generatedMcqs = questionsList;
            console.log(`[ExamGen] Groq AI generated ${generatedMcqs.length} dynamic unique MCQs.`);
          }
        } catch (groqErr) {
          console.warn("[ExamGen] Groq AI generation note:", groqErr.message);
        }
      }
    }

    // 2. Secondary Provider: Mistral AI (mistral-small-latest)
    if (!generatedMcqs || generatedMcqs.length === 0) {
      const mistralKey = process.env.MISTRAL_API_KEY;
      if (mistralKey) {
        try {
          const mistralRes = await axios.post(
            "https://api.mistral.ai/v1/chat/completions",
            {
              model: "mistral-small-latest",
              messages: [
                { role: "system", content: "You are an expert technical interviewer that outputs raw JSON only." },
                { role: "user", content: systemPrompt }
              ],
              temperature: 0.7,
            },
            {
              headers: { Authorization: `Bearer ${mistralKey}`, "Content-Type": "application/json" },
              timeout: 10000
            }
          );
          const rawContent = (mistralRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(rawContent);
          const questionsList = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.mcqs || parsed.mcq_questions || []);
          if (questionsList.length >= 5) {
            generatedMcqs = questionsList;
            console.log(`[ExamGen] Mistral AI generated ${generatedMcqs.length} dynamic unique MCQs.`);
          }
        } catch (mistralErr) {
          console.warn("[ExamGen] Mistral AI generation note:", mistralErr.message);
        }
      }
    }

    // 3. Tertiary Provider: OpenRouter (DeepSeek / Meta LLaMA / Claude)
    if (!generatedMcqs || generatedMcqs.length === 0) {
      const openRouterKey = process.env.OPENROUTER_API_KEY;
      if (openRouterKey) {
        try {
          const orRes = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
              model: "meta-llama/llama-3.1-8b-instruct:free",
              messages: [
                { role: "system", content: "You are an expert technical interviewer that outputs raw JSON only." },
                { role: "user", content: systemPrompt }
              ],
              temperature: 0.7,
            },
            {
              headers: { Authorization: `Bearer ${openRouterKey}`, "Content-Type": "application/json" },
              timeout: 10000
            }
          );
          const rawContent = (orRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(rawContent);
          const questionsList = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.mcqs || parsed.mcq_questions || []);
          if (questionsList.length >= 5) {
            generatedMcqs = questionsList;
            console.log(`[ExamGen] OpenRouter generated ${generatedMcqs.length} dynamic unique MCQs.`);
          }
        } catch (orErr) {
          console.warn("[ExamGen] OpenRouter generation note:", orErr.message);
        }
      }
    }

    // 4. Quaternary Provider: Python AI Engine
    if (!generatedMcqs || generatedMcqs.length === 0) {
      try {
        const pythonRes = await axios.post(
          `${PYTHON_API_BASE}/generate-assessment`,
          {
            claims: formattedClaims,
            difficulty: jobDifficulty,
            resume_description: resumeText,
            job_description: jobDescription,
            job_title: jobTitle,
            entropy: Date.now() + Math.random(),
          },
          { timeout: 10000 }
        );
        if (pythonRes.data.result?.mcq_questions?.length >= 5) {
          generatedMcqs = pythonRes.data.result.mcq_questions;
        }
      } catch (pyErr) {
        console.warn("[ExamGen] Python Engine note:", pyErr.message);
      }
    }

    // 5. Zero-Failure Fallback: Dynamic Randomized Algorithmic Engine
    if (!generatedMcqs || !Array.isArray(generatedMcqs) || generatedMcqs.length === 0) {
      generatedMcqs = generateDynamicAlgorithmicQuestions(effectiveSkills, jobDifficulty);
    }

    // ── Save exam to DB ────────────────────────────────────────────────
    const exam = await Exam.create({
      candidateId: req.user._id,
      topic: (invitation || applicant) ? "Job Alignment Assessment" : "Dynamic Practice Exam",
      skills: effectiveSkills,
      passingScore: 70,
      status: "In Progress",
      questions: generatedMcqs.map((q) => {
        const options = Array.isArray(q.options) ? q.options : ["Option A", "Option B", "Option C", "Option D"];
        const targetAns = q.correct_answer || q.correctAnswer || options[0];
        const correctIdx = options.indexOf(targetAns);
        return {
          questionText: q.question_text || q.question || "Technical Question",
          options,
          correctOption: correctIdx !== -1 ? correctIdx : 0,
          skill: q.skill || q.category || effectiveSkills[0] || "Technical",
        };
      }),
    });

    // Mark exam status as In Progress for this candidate on recruiter workspace
    await RecruiterApplicant.updateMany(
      {
        $or: [
          { candidateUser: req.user._id },
          { extractedEmail: req.user.email },
          { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
          ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
        ]
      },
      { examStatus: "In Progress" }
    );

    // ── Format for frontend UI ─────────────────────────────────────────
    const frontendQuestions = exam.questions.map((q, idx) => ({
      _id: q._id,
      category: q.skill || effectiveSkills[0] || "General",
      difficulty: q.difficulty || (idx < 10 ? "Easy" : idx < 25 ? "Medium" : "Hard"),
      text: q.questionText,
      options: q.options,
    }));

    res.json(frontendQuestions);
  } catch (error) {
    console.error("Start Exam Error:", error.stack || error.message);
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
    // Invited candidates are pre-verified by the recruiter pipeline — bypass the guard
    const isInvitedCandidate = req.user.origin === "recruiter_invited";

    if (!isInvitedCandidate) {
      const hasActiveExam = await Exam.exists({ candidateId: req.user._id });
      if (!hasActiveExam) {
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
      }
    }

    const { answers = [], code_snippet, behavioral_response, isTerminated = false } = req.body;

    // Handle security termination / violation disqualification
    if (isTerminated) {
      const RecruiterApplicant = require("../models/RecruiterApplicant");
      await RecruiterApplicant.updateMany(
        {
          $or: [
            { candidateUser: req.user._id },
            { extractedEmail: req.user.email },
            { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
          ]
        },
        {
          status: "Disqualified",
          examStatus: "Violated",
          examScore: 0,
          reasoning: "Disqualified due to proctoring and security violations during assessment."
        }
      );

      const exam = await Exam.findOne({ candidateId: req.user._id }).sort({ createdAt: -1 });
      if (exam) {
        exam.status = "Terminated";
        exam.score = 0;
        await exam.save();
      }

      return res.status(200).json({
        success: false,
        disqualified: true,
        score: 0,
        message: "Assessment terminated due to security violations. Result disqualified.",
      });
    }

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

    const user = await User.findById(req.user._id);
    if (user) {
      const categories = exam ? exam.skills : ["Software Engineering"];
      const certTitle = `${categories[0] || "Software Engineering"} Professional Certificate`;
      const credentialId = `VP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      if (isPassed) {
        certificate = {
          title: certTitle,
          issuedAt: new Date(),
          issuer: "VeriProof Authority",
          credentialId: credentialId,
          techStack: categories,
          verificationUrl: `/verify-credential/${credentialId}`,
        };
        user.certificates.push(certificate);
      }

      // Advance pipelineStage to verification_complete for all candidate types
      user.pipelineStage = "verification_complete";
      await user.save();

      // Rebuild skill progression & skill tree from all evidence (resume, repo, exam)
      await rebuildSkillProgression(user._id, {
        type: "exam",
        label: certTitle,
        technologies: categories,
        score,
        xp: isPassed ? 160 : 60,
        completed: isPassed,
        source: credentialId || "assessment",
      });
    }

    if (exam) {
      exam.status = "Completed";
      exam.score = score;
      exam.timeTaken = 30;
      exam.codeQuality = score;
      exam.answers = answers;
      await exam.save();
    }

    // Check if candidate already has an official completed attempt on recruiter pipeline
    const RecruiterApplicant = require("../models/RecruiterApplicant");
    const existingOfficialApplicant = await RecruiterApplicant.findOne({
      $or: [
        { candidateUser: req.user._id },
        { extractedEmail: req.user.email },
        { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
      ],
      examStatus: { $in: ["Attended", "Completed"] }
    });

    const isFirstOfficialAttempt = !existingOfficialApplicant;

    // Upsert VerificationResult & ResumeAnalysis for EVERY candidate type (Self-Registered, Invited, Recruiter)
    const InvitationRegistry = require("../models/InvitationRegistry");
    const matchedInvitation = await InvitationRegistry.findOne({
      $or: [
        { email: req.user.email },
        { email: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
        ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
      ]
    });
    const jobId = matchedInvitation?.jobId || null;

    let vResult = await VerificationResult.findOne({
      candidateId: req.user._id,
      ...(jobId ? { jobId } : {}),
    }).sort({ createdAt: -1 }) || await VerificationResult.findOne({ candidateId: req.user._id }).sort({ createdAt: -1 });

    const alignScore = vResult?.alignmentScore || 85;
    const compositeTrustScore = Math.min(100, Math.max(0, Math.round((alignScore * 0.4) + (score * 0.4) + 20)));

    if (vResult) {
      if (isFirstOfficialAttempt) {
        vResult.examScore = score;
        vResult.trustScore = compositeTrustScore;
        vResult.status = isPassed ? "Verified" : "Failed";
      }
      if (!vResult.alignmentScore) vResult.alignmentScore = alignScore;
      if (jobId && !vResult.jobId) vResult.jobId = jobId;
      await vResult.save();
    } else {
      vResult = await VerificationResult.create({
        candidateId: req.user._id,
        jobId,
        examScore: score,
        alignmentScore: alignScore,
        trustScore: compositeTrustScore,
        status: isPassed ? "Verified" : "Failed",
        matchedSkills: exam?.skills || ["Software Engineering"],
        missingSkills: [],
      });
    }

    // Update ResumeAnalysis with verification & trust score
    await ResumeAnalysis.findOneAndUpdate(
      { candidateId: req.user._id },
      { status: "Analysis Complete", verificationScore: score, trustScore: compositeTrustScore },
      { upsert: true, new: true }
    );

    // Update User model trustScore & verificationScore
    if (user) {
      if (!user.skillProgress) user.skillProgress = {};
      if (isFirstOfficialAttempt) {
        user.skillProgress.trustScore = compositeTrustScore;
        user.skillProgress.verificationScore = score;
      }
      user.skillProgress.completedAssessments = (user.skillProgress.completedAssessments || 0) + 1;
      user.pipelineStage = "verification_complete";
      await user.save();
    }

    // Only update recruiter pipeline on FIRST official attempt
    if (isFirstOfficialAttempt) {
      await RecruiterApplicant.updateMany(
        {
          $or: [
            { candidateUser: req.user._id },
            { extractedEmail: req.user.email },
            { extractedEmail: new RegExp(`^${req.user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
          ]
        },
        {
          status: "Completed",
          candidateUser: req.user._id,
          examScore: score,
          examStatus: "Attended",
          reasoning: `Assessment completed. Score: ${score}%. Verification Verdict: ${isPassed ? 'VERIFIED' : 'NEEDS IMPROVEMENT'}. Composite Trust Score: ${compositeTrustScore}%.`
        }
      );
    }

    // ── Build failed questions analysis ─────────────────────────────────
    const failedQuestions = [];
    if (exam) {
      const questionMap = new Map(
        exam.questions.map((q) => [q._id.toString(), q])
      );
      answers.forEach(({ questionId, answerIndex }) => {
        const q = questionMap.get(String(questionId));
        if (q && q.correctOption !== answerIndex) {
          failedQuestions.push({
            question: q.questionText,
            yourAnswer: q.options[answerIndex] || "Not answered",
            correctAnswer: q.options[q.correctOption],
            skill: q.skill || "Technical",
          });
        }
      });
    }

    // Send emails if this was their first official attempt
    if (isFirstOfficialAttempt) {
      try {
        const scoreColor = isPassed ? "#34d399" : "#f87171";
        const verdict = isPassed ? "PASSED \u2705" : "NEEDS IMPROVEMENT \u274c";

        const failedHtml = failedQuestions.length > 0
          ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:12px;">
              <thead><tr style="background:#1a2040;">
                <th style="padding:8px 10px;text-align:left;color:#94a0b8;">Skill</th>
                <th style="padding:8px 10px;text-align:left;color:#94a0b8;">Question</th>
                <th style="padding:8px 10px;text-align:left;color:#f87171;">Your Answer</th>
                <th style="padding:8px 10px;text-align:left;color:#34d399;">Correct Answer</th>
              </tr></thead>
              <tbody>${failedQuestions.map((fq, i) => `
                <tr style="background:${i % 2 === 0 ? '#0d1226' : '#0a0e1a'};">
                  <td style="padding:8px 10px;color:#6b8aff;font-weight:600;">${fq.skill}</td>
                  <td style="padding:8px 10px;color:#c8d0e4;">${fq.question}</td>
                  <td style="padding:8px 10px;color:#f87171;">${fq.yourAnswer}</td>
                  <td style="padding:8px 10px;color:#34d399;">${fq.correctAnswer}</td>
                </tr>`).join('')}
              </tbody>
            </table>`
          : `<p style="color:#34d399;font-weight:600;">Perfect score — no incorrect answers!</p>`;

        // Email to Candidate
        if (user?.email) {
          const candidateHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:620px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Forensic Credential Intelligence</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${user.name || "Candidate"}</strong>,</p>
    <p>You have completed your technical assessment. Here are your official results:</p>
    <div style="background:#0d1226;border:1px solid #1a2040;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
      <div style="font-size:48px;font-weight:900;color:${scoreColor};">${score}%</div>
      <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-top:4px;">${verdict}</div>
      <div style="font-size:12px;color:#5a6478;margin-top:8px;">Passing threshold: 70% &bull; Questions: ${totalQuestions} &bull; Correct: ${correctCount}</div>
    </div>
    ${failedQuestions.length > 0 ? `
    <h3 style="color:#e8ecf4;font-size:14px;font-weight:700;margin-bottom:8px;">Question Analysis (${failedQuestions.length} incorrect):</h3>
    ${failedHtml}` : ""}
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Forensic Credential Intelligence</p>
  </div>
</body></html>`;

          sendEmail({
            email: user.email,
            subject: `[VeriProof] Your Assessment Results: ${score}% — ${verdict}`,
            html: candidateHtml,
          }).catch((err) => console.warn("[PostExam] Candidate email error:", err.message));
        }

        // Email to Recruiter
        const recruiterId = matchedInvitation?.recruiterId;
        if (recruiterId) {
          const recruiterUser = await User.findById(recruiterId);
          if (recruiterUser?.email) {
            const recruiterHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:620px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Candidate Assessment Notification</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${recruiterUser.name || "Recruiter"}</strong>,</p>
    <p>Candidate <strong>${user.name || req.user.email}</strong> (${req.user.email}) has just completed their technical assessment for your job role.</p>
    <div style="background:#0d1226;border:1px solid #6b8aff;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
      <div style="font-size:44px;font-weight:900;color:${scoreColor};">${score}%</div>
      <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-top:4px;">${verdict}</div>
      <div style="font-size:12px;color:#5a6478;margin-top:8px;">Score has been automatically synced to your Recruiter Verdicts &amp; Rankings Dashboard.</div>
    </div>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Forensic Credential Intelligence</p>
  </div>
</body></html>`;

            sendEmail({
              email: recruiterUser.email,
              subject: `[VeriProof Alert] Candidate ${user.name || req.user.email} completed assessment (${score}%)`,
              html: recruiterHtml,
            }).catch(err => console.warn("[PostExam] Recruiter notification email error:", err.message));
          }
        }
      } catch (postEmailErr) {
        console.warn("[PostExam] Email delivery note:", postEmailErr.message);
      }
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
      pipelineStage: "verification_complete",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get complete examination attempt history for candidate
// @route   GET /api/exams/history
// @access  Private
const getExamHistory = async (req, res) => {
  try {
    const exams = await Exam.find({ candidateId: req.user._id }).sort({ createdAt: 1 });

    let previousScore = 0;
    const history = exams.map((exam, index) => {
      const score = exam.score || 0;
      const totalQuestions = exam.questions?.length || 0;
      const correctAnswers = Math.round((score / 100) * totalQuestions);
      const isPassed = score >= (exam.passingScore || 70);

      // Group question accuracy by skill
      const skillStats = {};
      (exam.questions || []).forEach((q) => {
        const skill = q.skill || "Technical";
        if (!skillStats[skill]) skillStats[skill] = { total: 0, correct: 0 };
        skillStats[skill].total += 1;

        const candidateAnswer = (exam.answers || []).find((a) => String(a.questionId) === String(q._id));
        if (candidateAnswer && candidateAnswer.answerIndex === q.correctOption) {
          skillStats[skill].correct += 1;
        }
      });

      const weakSkills = [];
      const strongSkills = [];

      Object.entries(skillStats).forEach(([skill, stat]) => {
        const accuracy = stat.total > 0 ? (stat.correct / stat.total) * 100 : 0;
        if (accuracy < 60) weakSkills.push(skill);
        if (accuracy >= 80) strongSkills.push(skill);
      });

      const improvementDelta = index === 0 ? 0 : score - previousScore;
      previousScore = score;

      return {
        _id: exam._id,
        attemptNumber: index + 1,
        date: exam.createdAt,
        topic: exam.topic || "Technical Assessment",
        score,
        status: isPassed ? "Passed" : "Needs Improvement",
        passingScore: exam.passingScore || 70,
        totalQuestions,
        correctAnswers,
        weakSkills: weakSkills.length > 0 ? weakSkills : ["Edge Cases"],
        strongSkills: strongSkills.length > 0 ? strongSkills : exam.skills || ["Core Engineering"],
        improvementTrend: improvementDelta,
        codeQuality: exam.codeQuality || score,
      };
    });

    // Aggregated statistics
    const totalAttempts = history.length;
    const scores = history.map((h) => h.score);
    const bestScore = totalAttempts > 0 ? Math.max(...scores) : 0;
    const latestScore = totalAttempts > 0 ? scores[scores.length - 1] : 0;
    const avgScore = totalAttempts > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / totalAttempts) : 0;
    const passCount = history.filter((h) => h.status === "Passed").length;
    const passRate = totalAttempts > 0 ? Math.round((passCount / totalAttempts) * 100) : 0;
    const overallImprovement = totalAttempts > 1 ? scores[scores.length - 1] - scores[0] : 0;

    res.json({
      history,
      analytics: {
        totalAttempts,
        latestScore,
        bestScore,
        avgScore,
        passRate,
        overallImprovement,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  startExam,
  submitExam,
  getExamHistory,
};
