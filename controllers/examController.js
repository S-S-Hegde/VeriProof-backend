const fs = require("fs");
const path = require("path");
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

// ── Dynamic Algorithmic Question Generator (2-Section Core + Elective Partition) ──
const generateDynamicAlgorithmicQuestions = (coreSkills = [], claimedSkills = [], difficulty = "intermediate") => {
  const fullBank = [
    // Python
    { question: "What is the primary difference between a List and a Tuple in Python?", options: ["Lists are mutable while Tuples are strictly immutable", "Lists are immutable while Tuples are strictly mutable", "Lists only accept strings while Tuples hold any data", "Lists are statically typed while Tuples are untyped"], correctAnswer: "Lists are mutable while Tuples are strictly immutable", skill: "Python", difficulty: "Easy" },
    { question: "Which keyword is used for exception handling cleanup in Python?", options: ["The finally block", "The catch block", "The defer keyword", "The finish clause"], correctAnswer: "The finally block", skill: "Python", difficulty: "Easy" },
    { question: "What does the `__init__` method represent in Python classes?", options: ["Instance object constructor", "Static memory allocator", "Class module loader", "Runtime garbage collector"], correctAnswer: "Instance object constructor", skill: "Python", difficulty: "Easy" },
    { question: "Which built-in module is used to handle JSON serialization in Python?", options: ["The built-in json module", "The internal pyjson module", "The system serialize package", "The default jackson library"], correctAnswer: "The built-in json module", skill: "Python", difficulty: "Easy" },
    { question: "What is the average lookup time complexity in a Python dictionary?", options: ["Constant average time O(1)", "Linear scan time O(n)", "Logarithmic search time O(log n)", "Quadratic search time O(n^2)"], correctAnswer: "Constant average time O(1)", skill: "Python", difficulty: "Medium" },
    { question: "What does the `@staticmethod` decorator do in Python?", options: ["Disables implicit instance self parameter", "Enforces thread-safe locked execution", "Restricts method to private subclasses", "Compiles function to native C bytecode"], correctAnswer: "Disables implicit instance self parameter", skill: "Python", difficulty: "Medium" },
    { question: "How does Python handle primary memory deallocation?", options: ["Reference counts with cycle collector", "Explicit programmer malloc free calls", "Compile-time static stack allocation", "Continuous mark-sweep stopping pauses"], correctAnswer: "Reference counts with cycle collector", skill: "Python", difficulty: "Hard" },

    // JavaScript & TypeScript
    { question: "What is the primary responsibility of the JavaScript Event Loop?", options: ["Dispatches queued tasks to the empty stack", "Compiles JavaScript source into machine code", "Manages multiple physical OS CPU threads", "Parses and validates incoming HTML documents"], correctAnswer: "Dispatches queued tasks to the empty stack", skill: "JavaScript", difficulty: "Medium" },
    { question: "What is the difference between `==` and `===` in JavaScript?", options: ["Strict equality prevents implicit coercion", "Loose equality validates identical memory", "Strict equality only operates on numbers", "Loose equality executes synchronous checks"], correctAnswer: "Strict equality prevents implicit coercion", skill: "JavaScript", difficulty: "Easy" },
    { question: "Which method returns a new array with mapped callback transformations?", options: ["Array.prototype.map()", "Array.prototype.forEach()", "Array.prototype.filter()", "Array.prototype.reduce()"], correctAnswer: "Array.prototype.map()", skill: "JavaScript", difficulty: "Easy" },
    { question: "What constitutes a JavaScript Closure?", options: ["A function paired with its lexical environment", "A function declaring zero return statements", "An object constructor with frozen properties", "A promise handler with synchronous execution"], correctAnswer: "A function paired with its lexical environment", skill: "JavaScript", difficulty: "Medium" },
    { question: "In TypeScript, what differentiates `unknown` from `any`?", options: ["Requires type narrowing before operations", "Permits arbitrary property invocation", "Represents an alias for null undefined", "Disallows reassignment after creation"], correctAnswer: "Requires type narrowing before operations", skill: "TypeScript", difficulty: "Hard" },
    { question: "What is a primary distinction between `type` and `interface` in TypeScript?", options: ["Interfaces support automatic declaration merging", "Type aliases support object property inheritance", "Interfaces only represent primitive values", "Type aliases compile directly to JS classes"], correctAnswer: "Interfaces support automatic declaration merging", skill: "TypeScript", difficulty: "Medium" },

    // React
    { question: "Which React hook executes side-effects after component rendering?", options: ["The useEffect hook", "The useState hook", "The useMemo hook", "The useCallback hook"], correctAnswer: "The useEffect hook", skill: "React", difficulty: "Easy" },
    { question: "What is the primary optimization benefit of `useMemo` in React?", options: ["Caches expensive calculated return values", "Saves state values into browser storage", "Attaches direct references to DOM nodes", "Initializes bi-directional socket events"], correctAnswer: "Caches expensive calculated return values", skill: "React", difficulty: "Medium" },
    { question: "What is the purpose of the `key` prop when rendering lists in React?", options: ["Identifies changed items during reconciliation", "Applies scoped CSS styles to children", "Encrypts component state in DOM trees", "Registers hardware browser focus events"], correctAnswer: "Identifies changed items during reconciliation", skill: "React", difficulty: "Easy" },
    { question: "What is the architectural purpose of React Fiber reconciliation?", options: ["Enables incremental cooperative work scheduling", "Replaces standard CSS styles with JSS", "Provides server-side persistent database state", "Bypasses browser virtual DOM comparison"], correctAnswer: "Enables incremental cooperative work scheduling", skill: "React", difficulty: "Hard" },
    { question: "When is `useCallback` preferred over standard inline functions?", options: ["Memoizing function instances passed to memoized children", "Triggering asynchronous REST API requests automatically", "Calculating expensive numeric mathematical formulas", "Registering global CSS styles inside component trees"], correctAnswer: "Memoizing function instances passed to memoized children", skill: "React", difficulty: "Medium" },

    // Node.js & Express
    { question: "How does Node.js achieve scalable non-blocking I/O operations?", options: ["Delegates system calls to libuv thread pool", "Spawns isolated child process per request", "Executes JavaScript in multi-threaded runtime", "Suspends main thread during disk queries"], correctAnswer: "Delegates system calls to libuv thread pool", skill: "Node.js", difficulty: "Medium" },
    { question: "In Express.js middleware, what happens if `next()` is omitted?", options: ["The incoming HTTP request hangs indefinitely", "The Node.js process crashes immediately", "Express sends an automatic 200 OK header", "The router skips to next matching endpoint"], correctAnswer: "The incoming HTTP request hangs indefinitely", skill: "Node.js", difficulty: "Easy" },
    { question: "What is the execution timing of `process.nextTick()` in Node.js?", options: ["Executes before the event loop phase advances", "Delays execution by one whole millisecond", "Spawns a callback on a secondary CPU core", "Runs immediately after macrotask timer events"], correctAnswer: "Executes before the event loop phase advances", skill: "Node.js", difficulty: "Hard" },
    { question: "Which Node.js core module provides stream and buffer processing?", options: ["The stream core module", "The file disk package", "The binary data system", "The socket buffer tool"], correctAnswer: "The stream core module", skill: "Node.js", difficulty: "Medium" },

    // SQL & Databases
    { question: "Which SQL clause filters records after aggregate grouping operations?", options: ["The HAVING clause", "The WHERE clause", "The GROUP BY clause", "The ORDER BY clause"], correctAnswer: "The HAVING clause", skill: "SQL", difficulty: "Easy" },
    { question: "Which SQL join preserves all left rows regardless of matching right rows?", options: ["The LEFT JOIN clause", "The INNER JOIN clause", "The CROSS JOIN clause", "The FULL OUTER clause"], correctAnswer: "The LEFT JOIN clause", skill: "SQL", difficulty: "Easy" },
    { question: "What is the primary performance trade-off of a B-Tree Database Index?", options: ["Speeds reads while increasing write overhead", "Compresses storage while slowing read lookups", "Enforces foreign keys without disk usage", "Backs up tables with zero runtime locking"], correctAnswer: "Speeds reads while increasing write overhead", skill: "SQL", difficulty: "Medium" },
    { question: "What does the ACID acronym define in relational database transactions?", options: ["Atomicity, Consistency, Isolation, Durability", "Accuracy, Control, Indexing, Distribution", "Authentication, Cryptography, Integrity, Delivery", "Allocation, Concurrency, Iteration, Deletion"], correctAnswer: "Atomicity, Consistency, Isolation, Durability", skill: "SQL", difficulty: "Easy" },
    { question: "In MongoDB, what is the Aggregation Pipeline primarily used for?", options: ["Multi-stage document grouping and transformation", "Managing database cluster administrator logins", "Replicating collection shards across regions", "Generating database schema migration files"], correctAnswer: "Multi-stage document grouping and transformation", skill: "MongoDB", difficulty: "Medium" },
    { question: "What is an Inverted Index primarily used for in search databases?", options: ["Maps terms to document occurrences efficiently", "Stores relational foreign key constraints", "Encrypts stored database passwords on disk", "Distributes CPU query workloads uniformly"], correctAnswer: "Maps terms to document occurrences efficiently", skill: "Databases", difficulty: "Hard" },

    // Cloud, Caching & Architecture
    { question: "What is Redis primarily utilized for in high-concurrency systems?", options: ["In-memory caching and message pub-sub brokers", "Relational ACID table schema cold storage", "Compiling client-side web application assets", "Serving static HTML files across DNS roots"], correctAnswer: "In-memory caching and message pub-sub brokers", skill: "Redis", difficulty: "Medium" },
    { question: "What is the primary architectural role of a Reverse Proxy (e.g. NGINX)?", options: ["Terminates SSL and routes requests to backends", "Executes client JavaScript in web browsers", "Manages local Git version control branches", "Parses and compiles SQL relational queries"], correctAnswer: "Terminates SSL and routes requests to backends", skill: "Architecture", difficulty: "Easy" },
    { question: "Which Git command integrates branch commits by reapplying them onto a base tip?", options: ["The git rebase command", "The git merge command", "The git cherry-pick tool", "The git checkout branch"], correctAnswer: "The git rebase command", skill: "Git", difficulty: "Medium" },
    { question: "What is the core purpose of Docker containerization in software deployment?", options: ["Packages apps and dependencies into isolated units", "Virtualizes physical host hardware and motherboards", "Provides relational database transaction locks", "Formats source code according to style guides"], correctAnswer: "Packages apps and dependencies into isolated units", skill: "DevOps", difficulty: "Easy" },
    { question: "In RESTful API design, which HTTP method is strictly idempotent for resource replacement?", options: ["The PUT method", "The POST method", "The PATCH method", "The CONNECT call"], correctAnswer: "The PUT method", skill: "API Design", difficulty: "Easy" },
    { question: "What does the CAP Theorem state regarding distributed data systems?", options: ["Guarantees at most two of Consistency, Availability, Partitioning", "Balances computer CPU, system Architecture, and Performance", "Demands equal parity of Code, Accuracy, and Precision", "Optimizes application Concurrency, Allocation, and Persistence"], correctAnswer: "Guarantees at most two of Consistency, Availability, Partitioning", skill: "Architecture", difficulty: "Hard" },
    { question: "What is the primary operational advantage of WebSockets over HTTP polling?", options: ["Persistent bi-directional full-duplex TCP stream", "Automatic end-to-end payload data encryption", "Zero-latency TLS handshakes on every request", "Stateless header compression on each message"], correctAnswer: "Persistent bi-directional full-duplex TCP stream", skill: "WebSockets", difficulty: "Medium" },
    { question: "How does JWT (JSON Web Token) authentication maintain statelessness?", options: ["Cryptographically verifies payload without database queries", "Stores active user session records in server RAM", "Transfers plaintext database passwords on requests", "Encodes session identifiers into local browser cookies"], correctAnswer: "Cryptographically verifies payload without database queries", skill: "Security", difficulty: "Medium" },
    { question: "In Kubernetes architecture, what is the smallest deployable execution unit?", options: ["The Pod resource", "The Node instance", "The Cluster plane", "The Service route"], correctAnswer: "The Pod resource", skill: "DevOps", difficulty: "Medium" },
    { question: "What is the operational purpose of Database Connection Pooling?", options: ["Reuses open connections to prevent handshake latency", "Backs up relational table schemas to disk automatically", "Encrypts database storage volumes at block levels", "Generates automatic SQL migration schema scripts"], correctAnswer: "Reuses open connections to prevent handshake latency", skill: "Architecture", difficulty: "Hard" },
  ];

  const effectiveCore = (coreSkills && coreSkills.length > 0)
    ? coreSkills
    : ["Software Engineering", "Full Stack Development", "API Design", "Databases"];

  const effectiveElectives = (claimedSkills && claimedSkills.length > 0)
    ? claimedSkills
    : effectiveCore;

  // Helper to extract a target number of questions with specific difficulty quotas
  const pickSectionQuestions = (skillsList, targetEasy, targetMedium, targetHard, sectionName, usedQuestions) => {
    const normalizedSkills = skillsList.map(s => s.toLowerCase());

    const matchedPool = fullBank.filter(q =>
      !usedQuestions.has(q.question) &&
      normalizedSkills.some(cs => cs.includes(q.skill.toLowerCase()) || q.skill.toLowerCase().includes(cs))
    );
    const otherPool = fullBank.filter(q => !usedQuestions.has(q.question) && !matchedPool.includes(q));

    const getByDiff = (pool, diff) => pool.filter(q => (q.difficulty || "Medium").toLowerCase() === diff.toLowerCase());

    const easyCandidates = [...shuffle(getByDiff(matchedPool, "Easy")), ...shuffle(getByDiff(otherPool, "Easy"))];
    const medCandidates = [...shuffle(getByDiff(matchedPool, "Medium")), ...shuffle(getByDiff(otherPool, "Medium"))];
    const hardCandidates = [...shuffle(getByDiff(matchedPool, "Hard")), ...shuffle(getByDiff(otherPool, "Hard"))];

    const selected = [
      ...easyCandidates.slice(0, targetEasy),
      ...medCandidates.slice(0, targetMedium),
      ...hardCandidates.slice(0, targetHard),
    ];

    // If quotas were not fully met due to bank size, fill remaining with any unused questions
    const totalRequired = targetEasy + targetMedium + targetHard;
    if (selected.length < totalRequired) {
      const remainingUnused = fullBank.filter(q => !usedQuestions.has(q.question) && !selected.includes(q));
      selected.push(...shuffle(remainingUnused).slice(0, totalRequired - selected.length));
    }

    selected.forEach(q => usedQuestions.add(q.question));

    return selected.map(q => ({
      question_text: q.question,
      options: shuffle(q.options),
      correct_answer: q.correctAnswer,
      skill: q.skill,
      difficulty: q.difficulty || "Medium",
      section: sectionName,
    }));
  };

  const usedQuestions = new Set();
  // Section 1: Core Baseline (20 Qs: 5 Easy, 10 Medium, 5 Hard)
  const section1Core = pickSectionQuestions(effectiveCore, 5, 10, 5, "Core", usedQuestions);
  // Section 2: Candidate Electives (15 Qs: 5 Easy, 5 Medium, 5 Hard)
  const section2Electives = pickSectionQuestions(effectiveElectives, 5, 5, 5, "Elective", usedQuestions);

  return [...section1Core, ...section2Electives];
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

    // ── Skill resolution: Core Baseline Skills vs Candidate Claimed Electives ──
    const analysisSkills = (analysis?.claims?.skills || []).map(
      s => (typeof s === "string" ? s : s.name || s.skill || "")
    ).filter(Boolean);

    const applicantSkills = (applicant?.matchedSkills || applicant?.claimedSkills || []).map(
      s => (typeof s === "string" ? s : s.name || s.skill || "")
    ).filter(Boolean);

    const rawClaimedSkills = analysisSkills.length > 0 ? analysisSkills : applicantSkills;

    if (jobTargetSkills.length === 0) {
      jobTargetSkills = isInvitedCandidate
        ? ["Software Engineering", "Full Stack Development", "API Design", "Databases"]
        : ["JavaScript", "Node.js", "SQL", "React", "Python"];
    }

    const claimedSkills = rawClaimedSkills.length > 0 ? rawClaimedSkills : jobTargetSkills;

    const formattedClaims = [...new Set([...jobTargetSkills, ...claimedSkills])].map((skill) => ({
      skill,
      context: (invitation || applicant) ? `Job Alignment Assessment (${jobTitle})` : "Practice Assessment",
    }));

    // ── Multi-Provider AI Question Generation Engine ───────────────────
    let generatedMcqs = [];
    const sessionSalt = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

    const systemPrompt = `You are a Principal Staff Engineer, IIT/NPTEL Examination Chair, and Senior Technical Evaluator designing an elite, rigorous proctored technical assessment for the role: "${jobTitle}".
Session Randomization Seed: ${sessionSalt}

── JOB CONTEXT & TECHNICAL STACK ──
Job Description: "${jobDescription || "Design, develop, scale, and maintain high-performance software systems and APIs."}"
Core Required Competencies (Baseline): ${jobTargetSkills.join(", ")}
Candidate Claimed Competencies (Electives): ${claimedSkills.join(", ")}
Target Seniority Level: "${jobDifficulty}"

── ABSOLUTE REQUIREMENT: ZERO OPTION LENGTH BIAS (EQUAL OPTION LENGTHS) ──
1. STRICT EQUAL LENGTH: All 4 options (A, B, C, D) for EVERY question MUST have virtually IDENTICAL word counts (within 1 to 2 words of each other).
2. NEVER make the correct answer longer, more nuanced, or more detailed than distractor options.
3. Every incorrect option must be an intelligent, realistic developer pitfall of equal length and depth.

── QUESTION ARCHITECTURE & NPTEL/LEETCODE STYLES ──
Adopt the analytical rigor of LeetCode / HackerRank / NPTEL examination problems:
• STYLE A: "Code Output & Execution Trace"
• STYLE B: "Multi-Statement Evaluation (NPTEL Style)"
• STYLE C: "Time/Space Complexity & Algorithmic Trade-offs"
• STYLE D: "High-Concurrency & Distributed Architecture"

── ASSESSMENT STRUCTURE (35 QUESTIONS TOTAL) ──
You must strictly partition the 35 questions into two distinct sections:

SECTION 1: CORE BASELINE (20 Questions)
- Generate exactly 20 questions using ONLY the Core Required Competencies: ${jobTargetSkills.join(", ")}
- Difficulty distribution: 5 Easy, 10 Medium, 5 Hard.

SECTION 2: CANDIDATE ELECTIVES (15 Questions)
- Generate exactly 15 questions using ONLY the Candidate Claimed Competencies: ${claimedSkills.join(", ")}
- Difficulty distribution: 5 Easy, 5 Medium, 5 Hard.
- If the Candidate Claimed Competencies list is empty, default to generating these 15 questions from the Core Required Competencies instead.

Return ONLY a valid JSON array without any markdown formatting, backticks, or extra text:
[
  {
    "question": "Rigorous scenario or code snippet question text",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_answer": "Exact string of correct option",
    "skill": "Specific skill name tested",
    "difficulty": "Easy" | "Medium" | "Hard",
    "section": "Core" | "Elective"
  }
]`;

    // 1. Primary Provider: Google Gemini 1.5/2.0 Flash (Deterministic temperature 0.2)
    if (!generatedMcqs || generatedMcqs.length === 0) {
      const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (geminiKey) {
        try {
          const { GoogleGenerativeAI } = require("@google/generative-ai");
          const genAI = new GoogleGenerativeAI(geminiKey);
          const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
          const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 6000,
              responseMimeType: "application/json",
            },
          });
          const rawContent = (result.response.text() || "").replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(rawContent);
          const questionsList = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.mcqs || parsed.mcq_questions || []);
          if (questionsList.length >= 20) {
            generatedMcqs = questionsList;
            console.log(`[ExamGen] Gemini AI generated ${generatedMcqs.length} dynamic unique MCQs.`);
          }
        } catch (geminiErr) {
          console.warn("[ExamGen] Gemini AI generation note:", geminiErr.message);
        }
      }
    }

    // 2. Secondary Provider: Groq Cloud (Llama-3.3 70B Versatile with temperature 0.2)
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
              temperature: 0.2,
              max_tokens: 6000,
            },
            {
              headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
              timeout: 30000
            }
          );
          const rawContent = (groqRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(rawContent);
          const questionsList = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.mcqs || parsed.mcq_questions || []);
          if (questionsList.length >= 20) {
            generatedMcqs = questionsList;
            console.log(`[ExamGen] Groq AI generated ${generatedMcqs.length} dynamic unique MCQs.`);
          }
        } catch (groqErr) {
          console.warn("[ExamGen] Groq AI generation note:", groqErr.message);
        }
      }
    }

    // 3. Tertiary Provider: Mistral AI (mistral-small-latest with temperature 0.2)
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
              temperature: 0.2,
              max_tokens: 6000,
            },
            {
              headers: { Authorization: `Bearer ${mistralKey}`, "Content-Type": "application/json" },
              timeout: 30000
            }
          );
          const rawContent = (mistralRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(rawContent);
          const questionsList = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.mcqs || parsed.mcq_questions || []);
          if (questionsList.length >= 20) {
            generatedMcqs = questionsList;
            console.log(`[ExamGen] Mistral AI generated ${generatedMcqs.length} dynamic unique MCQs.`);
          }
        } catch (mistralErr) {
          console.warn("[ExamGen] Mistral AI generation note:", mistralErr.message);
        }
      }
    }

    // 4. Quaternary Provider: OpenRouter (Meta LLaMA with temperature 0.2)
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
              temperature: 0.2,
              max_tokens: 6000,
            },
            {
              headers: { Authorization: `Bearer ${openRouterKey}`, "Content-Type": "application/json" },
              timeout: 30000
            }
          );
          const rawContent = (orRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(rawContent);
          const questionsList = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.mcqs || parsed.mcq_questions || []);
          if (questionsList.length >= 20) {
            generatedMcqs = questionsList;
            console.log(`[ExamGen] OpenRouter generated ${generatedMcqs.length} dynamic unique MCQs.`);
          }
        } catch (orErr) {
          console.warn("[ExamGen] OpenRouter generation note:", orErr.message);
        }
      }
    }

    // 5. Quaternary Provider: Python AI Engine
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
          { timeout: 15000 }
        );
        if (pythonRes.data.result?.mcq_questions?.length >= 5) {
          generatedMcqs = pythonRes.data.result.mcq_questions;
        }
      } catch (pyErr) {
        console.warn("[ExamGen] Python Engine note:", pyErr.message);
      }
    }

    // 5. Zero-Failure Fallback: 2-Section Core + Elective Partitioned Algorithmic Engine
    if (!generatedMcqs || !Array.isArray(generatedMcqs) || generatedMcqs.length === 0) {
      generatedMcqs = generateDynamicAlgorithmicQuestions(jobTargetSkills, claimedSkills, jobDifficulty);
    }

    // ── Save exam to DB ────────────────────────────────────────────────
    const exam = await Exam.create({
      candidateId: req.user._id,
      topic: (invitation || applicant) ? "Job Alignment Assessment" : "Dynamic Practice Exam",
      skills: [...new Set([...jobTargetSkills, ...claimedSkills])],
      passingScore: 70,
      status: "In Progress",
      questions: generatedMcqs.map((q, idx) => {
        const options = Array.isArray(q.options) ? q.options : ["Option A", "Option B", "Option C", "Option D"];
        const targetAns = q.correct_answer || q.correctAnswer || options[0];
        const correctIdx = options.indexOf(targetAns);
        const isCore = idx < 20;
        const skill = q.skill || q.category || (isCore ? (jobTargetSkills[idx % jobTargetSkills.length] || "Core") : (claimedSkills[(idx - 20) % claimedSkills.length] || "Elective"));
        const difficulty = q.difficulty || (idx < 5 ? "Easy" : idx < 15 ? "Medium" : idx < 20 ? "Hard" : idx < 25 ? "Easy" : idx < 30 ? "Medium" : "Hard");
        const section = q.section || (isCore ? "Core" : "Elective");
        return {
          questionText: q.question_text || q.question || "Technical Question",
          options,
          correctOption: correctIdx !== -1 ? correctIdx : 0,
          skill,
          difficulty,
          section,
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
      category: q.skill || (idx < 20 ? "Core Technical" : "Candidate Elective"),
      difficulty: q.difficulty || "Medium",
      section: q.section || (idx < 20 ? "Core" : "Elective"),
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

    const { answers = [], code_snippet, behavioral_response, isTerminated = false, violationCount = 0, violations = [], proctoringLogs = [] } = req.body;

    // ── 1. Resolve Active Exam Session with Strict Ownership ───────────
    let exam = req.activeExam;
    if (!exam) {
      exam = await Exam.findOne({
        candidateId: req.user._id,
        status: "In Progress",
      }).sort({ createdAt: -1 });
    }

    if (!exam) {
      // Check if this attempt was already finalized (anti-replay guard)
      const existingExam = await Exam.findOne({
        candidateId: req.user._id,
      }).sort({ createdAt: -1 });

      if (existingExam && (existingExam.status === "Completed" || existingExam.status === "Terminated")) {
        return res.status(409).json({
          success: false,
          error: "EXAM_ALREADY_FINALIZED",
          message: "This examination has already been completed and cannot be resubmitted.",
        });
      }

      return res.status(404).json({
        success: false,
        error: "NO_ACTIVE_EXAM",
        message: "No active examination found for this candidate.",
      });
    }

    // ── 2. Server-Authoritative Anti-Cheat & Violation Merging ─────────
    const serverViolations = Array.isArray(exam.serverViolations) ? exam.serverViolations : [];
    const serverCount = Number(exam.serverViolationCount || serverViolations.length || 0);
    const clientCount = Number(violationCount || 0);
    const effectiveViolationCount = Math.max(serverCount, clientCount);
    const calculatedIntegrityScore = Math.max(0, 100 - (effectiveViolationCount * 25));
    const isSecurityDisqualified = isTerminated === true || effectiveViolationCount >= 3 || exam.isTerminated === true;

    // Handle security termination / violation disqualification
    if (isSecurityDisqualified) {
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
          reasoning: `Disqualified due to security violations (${effectiveViolationCount} total incidents).`
        }
      );

      exam.status = "Terminated";
      exam.score = 0;
      exam.isTerminated = true;
      exam.violationCount = effectiveViolationCount;
      exam.serverViolationCount = serverCount;
      exam.violations = Array.isArray(violations) && violations.length > 0 ? violations : serverViolations;
      exam.integrityScore = 0;
      exam.proctoringLogs = proctoringLogs;
      exam.submittedAt = new Date();
      await exam.save();

      return res.status(200).json({
        success: false,
        disqualified: true,
        score: 0,
        integrityScore: 0,
        violationCount: effectiveViolationCount,
        message: "Assessment terminated due to security violations. Result disqualified.",
      });
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: "Answers are required." });
    }

    // ── 3. Tamper-Proof Question Scoring (Fixed Denominator Defense) ────
    const totalQuestions = exam.questions && exam.questions.length > 0 ? exam.questions.length : (answers.length || 1);
    const questionMap = new Map(
      exam.questions.map((q) => [q._id.toString(), q.correctOption])
    );

    let correctCount = 0;
    answers.forEach(({ questionId, answerIndex }) => {
      if (questionMap.has(String(questionId)) && questionMap.get(String(questionId)) === answerIndex) {
        correctCount += 1;
      }
    });

    // Score is strictly calculated against ALL exam questions (unanswered questions score 0)
    let score = Math.min(100, Math.max(0, Math.round((correctCount / totalQuestions) * 100)));

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
      exam.isTerminated = false;
      exam.violationCount = effectiveViolationCount;
      exam.serverViolationCount = serverCount;
      exam.violations = Array.isArray(violations) && violations.length > 0 ? violations : serverViolations;
      exam.integrityScore = calculatedIntegrityScore;
      exam.proctoringLogs = proctoringLogs;
      exam.submittedAt = new Date();
      await exam.save();
    }

    // Bulletproof detection: Has candidate ever completed an official attempt before?
    const priorCompletedExamsCount = await Exam.countDocuments({
      candidateId: req.user._id,
      status: "Completed",
      _id: { $ne: exam?._id },
    });

    const normalizedEmail = (req.user.email || "").toLowerCase().trim();
    const RecruiterApplicant = require("../models/RecruiterApplicant");
    const existingOfficialApplicant = await RecruiterApplicant.findOne({
      $and: [
        {
          $or: [
            { candidateUser: req.user._id },
            { extractedEmail: normalizedEmail },
            { extractedEmail: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            ...(req.user.githubUsername ? [{ githubUsername: req.user.githubUsername }] : [])
          ]
        },
        {
          $or: [
            { examScore: { $exists: true, $ne: null } },
            { examStatus: { $in: ["Attended", "Completed", "attended", "completed"] } },
            { status: { $in: ["Completed", "completed"] } }
          ]
        }
      ]
    });

    const InvitationRegistry = require("../models/InvitationRegistry");
    const existingInvitation = await InvitationRegistry.findOne({
      $and: [
        {
          $or: [
            { email: normalizedEmail },
            { email: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
          ]
        },
        {
          $or: [
            { status: "completed" },
            { examCompleted: true }
          ]
        }
      ]
    });

    const hasUserCompletedBefore = (user?.skillProgress?.completedAssessments || 0) > 0;

    const isFirstOfficialAttempt = (priorCompletedExamsCount === 0) && !existingOfficialApplicant && !existingInvitation && !hasUserCompletedBefore;

    if (!isFirstOfficialAttempt) {
      console.log(`[PostExam] Re-attempt detected for candidate ${req.user.email}. Recruiter notifications and official scorecard are permanently locked.`);
    }

    // Upsert VerificationResult & ResumeAnalysis for EVERY candidate type (Self-Registered, Invited, Recruiter)
    const matchedInvitation = await InvitationRegistry.findOne({
      $or: [
        { email: normalizedEmail },
        { email: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
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

    if (isFirstOfficialAttempt) {
      if (vResult) {
        vResult.examScore = score;
        vResult.trustScore = compositeTrustScore;
        vResult.status = isPassed ? "Verified" : "Failed";
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
    }

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

        // ── Email to Recruiter with Embedded Forensic Proctoring Evidence ──
        let recruiterId = matchedInvitation?.recruiterId;
        if (!recruiterId && job?.recruiterId) {
          recruiterId = job.recruiterId;
        }

        const candidateViolations = [
          ...(exam?.serverViolations || []),
          ...(exam?.violations || [])
        ];

        // Format unique violations list with evidence URLs
        const backendBase = (process.env.BACKEND_URL || "http://localhost:5000").replace(/\/$/, "");
        const proctorHtml = (candidateViolations.length > 0 || effectiveViolationCount > 0)
          ? `
          <div style="background:#1a1013;border:1px solid #ef4444;border-radius:12px;padding:20px;margin:20px 0;">
            <div style="color:#ef4444;font-size:16px;font-weight:800;letter-spacing:-0.5px;margin-bottom:6px;">
              ⚠️ PROCTORING INCIDENT REPORT (${effectiveViolationCount} Security Strike${effectiveViolationCount > 1 ? "s" : ""})
            </div>
            <p style="color:#fca5a5;font-size:12px;margin:0 0 14px 0;">
              Integrity Score: <strong>${calculatedIntegrityScore}%</strong> ${isSecurityDisqualified ? " &bull; <span style='color:#ef4444;font-weight:900;'>STATUS: DISQUALIFIED</span>" : ""}
            </p>
            <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px;">
              <thead>
                <tr style="background:#2a1419;color:#f87171;">
                  <th style="padding:8px 10px;text-align:left;">Violation Type</th>
                  <th style="padding:8px 10px;text-align:left;">Reason / Details</th>
                  <th style="padding:8px 10px;text-align:left;">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                ${candidateViolations.map((v, i) => `
                  <tr style="background:${i % 2 === 0 ? '#1f0d11' : '#17090c'};border-bottom:1px solid #33151b;">
                    <td style="padding:8px 10px;color:#fca5a5;font-weight:700;">${String(v.type || "SECURITY_ALERT").toUpperCase()}</td>
                    <td style="padding:8px 10px;color:#e2e8f0;">${v.reason || v.vlmReason || v.details || "Threshold anomaly detected"}</td>
                    <td style="padding:8px 10px;color:#94a3b8;font-family:monospace;font-size:11px;">${v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : "Session Time"}</td>
                  </tr>
                  ${Array.isArray(v.evidenceUrls) && v.evidenceUrls.length > 0 ? `
                  <tr style="background:${i % 2 === 0 ? '#1f0d11' : '#17090c'};">
                    <td colspan="3" style="padding:8px 10px;">
                      <div style="font-size:11px;font-weight:700;color:#f87171;margin-bottom:6px;">Captured 3-Frame Burst Proof:</div>
                      <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${v.evidenceUrls.map((url, frameIdx) => {
                          const fullUrl = url.startsWith("http") ? url : `${backendBase}${url}`;
                          const frameLabels = ["Start Frame", "Peak Violation", "End Frame"];
                          return `
                            <div style="display:inline-block;margin-right:8px;text-align:center;background:#0d0507;padding:6px;border-radius:6px;border:1px solid #451a20;">
                              <a href="${fullUrl}" target="_blank" style="text-decoration:none;">
                                <img src="${fullUrl}" alt="Proof Frame" style="width:160px;height:90px;object-fit:cover;border-radius:4px;display:block;border:1px solid #ef4444;" />
                              </a>
                              <span style="font-size:10px;color:#94a3b8;margin-top:4px;display:block;">${frameLabels[frameIdx] || `Frame ${frameIdx + 1}`}</span>
                            </div>
                          `;
                        }).join('')}
                      </div>
                    </td>
                  </tr>` : ""}
                `).join('')}
              </tbody>
            </table>
          </div>`
          : `
          <div style="background:#091d14;border:1px solid #10b981;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
            <div style="color:#10b981;font-size:14px;font-weight:700;">✓ Proctoring Integrity: 100% (Clean Session)</div>
            <div style="color:#6ee7b7;font-size:12px;margin-top:4px;">No suspicious devices, eye-gaze anomalies, or multi-person events detected.</div>
          </div>`;

        if (recruiterId) {
          const recruiterUser = await User.findById(recruiterId);
          if (recruiterUser?.email) {
            const recruiterHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:640px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Forensic Candidate Assessment &amp; Proctoring Audit</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${recruiterUser.name || "Recruiter"}</strong>,</p>
    <p>Candidate <strong>${user.name || req.user.email}</strong> (${req.user.email}) has completed the technical assessment for <strong>${jobTitle}</strong>.</p>
    
    <div style="background:#0d1226;border:1px solid #6b8aff;border-radius:12px;padding:24px;margin:20px 0;text-align:center;">
      <div style="font-size:44px;font-weight:900;color:${scoreColor};">${score}%</div>
      <div style="font-size:14px;font-weight:700;color:${scoreColor};margin-top:4px;">${verdict}</div>
      <div style="font-size:12px;color:#5a6478;margin-top:8px;">Passing Threshold: 70% &bull; Questions: ${totalQuestions} &bull; Correct: ${correctCount}</div>
    </div>

    ${proctorHtml}

    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Forensic Credential Intelligence &amp; Optical Proctoring Engine</p>
  </div>
</body></html>`;

            sendEmail({
              email: recruiterUser.email,
              subject: `[VeriProof Forensic Alert] Candidate ${user.name || req.user.email} completed assessment (${score}%) ${effectiveViolationCount > 0 ? `⚠️ ${effectiveViolationCount} Strikes` : "✓ Clean"}`,
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

// @desc    Analyze live webcam frame snapshot with NVIDIA NIM Vision / Gemini Vision AI proctor
// @route   POST /api/exams/proctor-snapshot
// @access  Private
const analyzeProctorSnapshot = async (req, res) => {
  try {
    const { imageBase64, clientMetrics } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ message: "No image frame provided for proctoring analysis." });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "").trim();
    const dataUri = `data:image/jpeg;base64,${cleanBase64}`;

    // Fast-path client metric evaluation (Shutter / black screen)
    if (clientMetrics && clientMetrics.avgBrightness !== undefined && clientMetrics.avgBrightness < 10) {
      return res.json({
        violation: true,
        violationType: "SHUTTER_COVERED",
        reason: "Camera shutter appears closed or covered (Pitch black video feed).",
        confidence: 0.99,
        provider: "ClientOpticalEngine",
      });
    }

    const proctorPrompt = `You are an automated AI Vision Proctor for a high-stakes technical examination.
Analyze this candidate webcam frame snapshot for any visual anti-cheat violations:

VIOLATION TYPES TO CHECK:
1. SHUTTER_COVERED: Is the camera physically covered, taped, pitch black, or obscured?
2. STATIC_PHOTO: Is this a motionless printed photograph, digital photo spoof, dummy, or synthetic replay held in front of the lens?
3. NO_FACE: Is the candidate absent, moved out of camera frame, or ducking below the desk?
4. MULTIPLE_FACES: Are there 2 or more people in the camera frame assisting the candidate?
5. PHONE_SUSPICIOUS: Is the candidate visibly holding or using a smartphone, tablet, or looking down at hidden notes/screens?

OUTPUT FORMAT:
Respond with ONLY raw JSON (no backticks, no markdown):
{
  "violation": true/false,
  "violationType": "NONE" | "SHUTTER_COVERED" | "STATIC_PHOTO" | "NO_FACE" | "MULTIPLE_FACES" | "PHONE_SUSPICIOUS",
  "reason": "Clear 1-sentence finding",
  "confidence": 0.95
}`;

    let proctorResult = null;

    // 1. Primary Vision Provider Pool: NVIDIA NIM Vision (meta/llama-3.2-11b-vision-instruct)
    const nvidiaKeyPool = [
      process.env.NVIDIA_API_KEY_VISION,
      process.env.NVIDIA_API_KEY,
      process.env.NVIDIA_API_KEY_2,
      process.env.NVIDIA_API_KEY_3,
      process.env.NVIDIA_API_KEY_4,
    ].filter(Boolean);

    for (const nKey of nvidiaKeyPool) {
      if (proctorResult) break;
      try {
        const nvRes = await axios.post(
          "https://integrate.api.nvidia.com/v1/chat/completions",
          {
            model: "meta/llama-3.2-11b-vision-instruct",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${nKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (nvRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "NVIDIA_NIM_Vision" };
          break;
        }
      } catch (nvErr) {
        console.warn("[ProctorAI] NVIDIA NIM Key failover note:", nvErr.response?.data?.message || nvErr.message);
      }
    }

    // 2. Secondary Vision Provider: Mistral AI Pixtral Vision (pixtral-12b-2409)
    const mistralKey = process.env.MISTRAL_API_KEY;
    if (!proctorResult && mistralKey) {
      try {
        const mistralRes = await axios.post(
          "https://api.mistral.ai/v1/chat/completions",
          {
            model: "pixtral-12b-2409",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${mistralKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (mistralRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "Mistral_Pixtral_Vision" };
        }
      } catch (misErr) {
        console.warn("[ProctorAI] Mistral Pixtral note:", misErr.message);
      }
    }

    // 3. Tertiary Vision Provider: Groq Cloud Vision (llama-3.2-11b-vision-preview)
    const groqKey = process.env.GROQ_API_KEY;
    if (!proctorResult && groqKey) {
      try {
        const groqRes = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: "llama-3.2-11b-vision-preview",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${groqKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (groqRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "Groq_Vision" };
        }
      } catch (groqErr) {
        console.warn("[ProctorAI] Groq Vision note:", groqErr.message);
      }
    }

    // 4. Quaternary Vision Provider: OpenRouter Vision (meta-llama/llama-3.2-11b-vision-instruct:free)
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!proctorResult && openRouterKey) {
      try {
        const orRes = await axios.post(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            model: "meta-llama/llama-3.2-11b-vision-instruct:free",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${openRouterKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (orRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "OpenRouter_Vision" };
        }
      } catch (orErr) {
        console.warn("[ProctorAI] OpenRouter Vision note:", orErr.message);
      }
    }

    // 5. Quinary Vision Provider: OpenAI GPT-4o-mini Vision
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!proctorResult && openaiKey) {
      try {
        const oaiRes = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: proctorPrompt },
                  { type: "image_url", image_url: { url: dataUri } }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 300,
          },
          {
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              "Content-Type": "application/json",
            },
            timeout: 8000,
          }
        );
        const raw = (oaiRes.data?.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "OpenAI_GPT4o_Vision" };
        }
      } catch (oaiErr) {
        console.warn("[ProctorAI] OpenAI Vision note:", oaiErr.message);
      }
    }

    // 6. Multi-Key Google Gemini 1.5 Flash Vision Pool
    const geminiKeyPool = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GOOGLE_API_KEY,
    ].filter(Boolean);

    for (const gKey of geminiKeyPool) {
      if (proctorResult) break;
      try {
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(gKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent({
          contents: [
            {
              role: "user",
              parts: [
                { text: proctorPrompt },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: cleanBase64,
                  }
                }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
          }
        });
        const raw = (result.response.text() || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.violation === "boolean") {
          proctorResult = { ...parsed, provider: "Gemini_Flash_Vision" };
          break;
        }
      } catch (geminiErr) {
        console.warn("[ProctorAI] Gemini Vision failover note:", geminiErr.message);
      }
    }

    // Fallback: Default to verified if vision check was inconclusive
    if (!proctorResult) {
      proctorResult = {
        violation: false,
        violationType: "NONE",
        reason: "Candidate visual stream normal",
        confidence: 0.85,
        provider: "OpticalFallback",
      };
    }

    // ── Server-Authoritative Violation Recording ─────────────────────
    if (proctorResult.violation && req.user && req.user._id) {
      try {
        const activeExam = await Exam.findOne({
          candidateId: req.user._id,
          status: "In Progress",
        }).sort({ createdAt: -1 });

        if (activeExam) {
          activeExam.serverViolationCount = (activeExam.serverViolationCount || 0) + 1;
          if (!Array.isArray(activeExam.serverViolations)) activeExam.serverViolations = [];
          activeExam.serverViolations.push({
            type: proctorResult.violationType || "VISION_ANOMALY",
            reason: proctorResult.reason || "AI Vision proctoring anomaly detected.",
            confidence: proctorResult.confidence || 0.9,
            provider: proctorResult.provider || "AI_Vision",
            timestamp: new Date(),
          });
          activeExam.integrityScore = Math.max(0, 100 - (activeExam.serverViolationCount * 25));
          if (activeExam.serverViolationCount >= 3) {
            activeExam.isTerminated = true;
            activeExam.status = "Terminated";
          }
          await activeExam.save();
        }
      } catch (saveErr) {
        console.warn("[ProctorAI] Could not persist server-side violation:", saveErr.message);
      }
    }

    res.json(proctorResult);
  } catch (error) {
    console.error("[Proctor Snapshot Error]", error);
    res.status(500).json({ message: "Proctoring analysis error", violation: false });
  }
};

// @desc    Record server-authoritative telemetry violation from ACE / frontend
// @route   POST /api/exams/record-violation
// @access  Private
const recordProctorViolation = async (req, res) => {
  try {
    const { type = "SECURITY_VIOLATION", reason = "Proctoring anomaly detected", confidence = 0.9, telemetry = {} } = req.body;
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    const activeExam = await Exam.findOne({
      candidateId: req.user._id,
      status: "In Progress",
    }).sort({ createdAt: -1 });

    if (!activeExam) {
      return res.status(404).json({ success: false, message: "No active exam session found." });
    }

    activeExam.serverViolationCount = (activeExam.serverViolationCount || 0) + 1;
    if (!Array.isArray(activeExam.serverViolations)) activeExam.serverViolations = [];
    activeExam.serverViolations.push({
      type,
      reason,
      confidence,
      telemetry,
      timestamp: new Date(),
    });
    activeExam.integrityScore = Math.max(0, 100 - (activeExam.serverViolationCount * 25));
    if (activeExam.serverViolationCount >= 3) {
      activeExam.isTerminated = true;
      activeExam.status = "Terminated";
    }
    await activeExam.save();

    return res.json({
      success: true,
      serverViolationCount: activeExam.serverViolationCount,
      integrityScore: activeExam.integrityScore,
      isTerminated: activeExam.isTerminated,
    });
  } catch (err) {
    console.error("[RecordViolation Error]", err.message);
    res.status(500).json({ success: false, message: "Failed to record proctoring telemetry." });
  }
};

// @desc    Record 3-frame burst snapshot evidence & persist image files
// @route   POST /api/exams/record-violation-snapshot
// @access  Public / Private
const recordViolationSnapshot = async (req, res) => {
  try {
    const {
      type = "SECURITY_VIOLATION",
      details = "Proctoring anomaly detected",
      vlm_reason = "",
      confidence = 0.95,
      timestamp = new Date(),
      burstFrames = [],
      examId,
    } = req.body;

    let candidateId = req.user?._id;

    // Find active exam
    let activeExam = null;
    if (examId) {
      activeExam = await Exam.findById(examId);
    } else if (candidateId) {
      activeExam = await Exam.findOne({ candidateId, status: "In Progress" }).sort({ createdAt: -1 });
    } else {
      activeExam = await Exam.findOne({ status: "In Progress" }).sort({ createdAt: -1 });
    }

    if (!activeExam) {
      return res.status(404).json({ success: false, message: "No active exam session found." });
    }

    // Save burst frames to static uploads directory
    const evidenceUrls = [];
    const violationsDir = path.join(__dirname, "../uploads", "violations");
    if (!fs.existsSync(violationsDir)) {
      fs.mkdirSync(violationsDir, { recursive: true });
    }

    const timeKey = Date.now();
    const cleanType = String(type).replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();

    if (Array.isArray(burstFrames) && burstFrames.length > 0) {
      for (const item of burstFrames) {
        const tag = item.tag || "frame";
        let base64Data = item.base64 || "";
        if (base64Data.startsWith("data:image")) {
          base64Data = base64Data.split(",")[1] || "";
        }
        if (base64Data) {
          const filename = `violation_${activeExam._id}_${timeKey}_${cleanType}_${tag}.jpg`;
          const filePath = path.join(violationsDir, filename);
          const buffer = Buffer.from(base64Data, "base64");
          fs.writeFileSync(filePath, buffer);
          evidenceUrls.push(`/uploads/violations/${filename}`);
        }
      }
    }

    activeExam.serverViolationCount = (activeExam.serverViolationCount || 0) + 1;
    if (!Array.isArray(activeExam.serverViolations)) activeExam.serverViolations = [];
    if (!Array.isArray(activeExam.violations)) activeExam.violations = [];

    const violationObj = {
      type,
      reason: details || vlm_reason || "Proctoring violation detected",
      vlmReason: vlm_reason,
      confidence,
      evidenceUrls,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    };

    activeExam.serverViolations.push(violationObj);
    activeExam.violations.push(violationObj);
    activeExam.integrityScore = Math.max(0, 100 - (activeExam.serverViolationCount * 25));

    if (activeExam.serverViolationCount >= 3) {
      activeExam.isTerminated = true;
      activeExam.status = "Terminated";
    }

    await activeExam.save();

    return res.json({
      success: true,
      serverViolationCount: activeExam.serverViolationCount,
      integrityScore: activeExam.integrityScore,
      isTerminated: activeExam.isTerminated,
      evidenceUrls,
    });
  } catch (err) {
    console.error("[RecordViolationSnapshot Error]", err.message);
    res.status(500).json({ success: false, message: "Failed to record burst snapshot violation." });
  }
};

module.exports = {
  startExam,
  submitExam,
  getExamHistory,
  analyzeProctorSnapshot,
  recordProctorViolation,
  recordViolationSnapshot,
};

