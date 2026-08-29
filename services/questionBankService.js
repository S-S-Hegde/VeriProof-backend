const QuestionBank = require("../models/QuestionBank");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const ARCHETYPES = [
  "Code Tracing",
  "System Design",
  "Debugging",
  "Anti-patterns",
];

// Helper: Fisher-Yates Shuffle
const shuffleArray = (arr) => {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

// Initial Seed Questions (High-quality baseline across common skills)
const SEED_QUESTIONS = [
  // JavaScript
  {
    skillName: "JavaScript",
    archetype: "Debugging",
    question: "What is the result of typeof NaN in JavaScript, and what is the reason for this behavior?",
    correct_answer: "It returns 'number' because NaN is defined in IEEE 754 as a numeric value representing an unrepresentable value.",
    distractors: [
      "It returns 'undefined' because NaN represents a missing or uninitialized arithmetic property.",
      "It returns 'object' because all non-primitive mathematical errors inherit from Error.prototype.",
      "It returns 'NaN' because JavaScript implements a dedicated primitive data type for numeric errors."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "JavaScript",
    archetype: "Code Tracing",
    question: "What will `console.log(1 + '2' + 3)` output in JavaScript due to implicit type coercion?",
    correct_answer: "'123' because numeric addition with a string triggers string concatenation left-to-right.",
    distractors: [
      "'6' because numeric strings are automatically cast to numbers during consecutive arithmetic.",
      "'15' because the second operation converts the remaining numeric operands to an addition.",
      "NaN because performing addition with mismatched data types causes an implicit evaluation fault."
    ],
    difficulty: "Easy",
  },
  {
    skillName: "JavaScript",
    archetype: "System Design",
    question: "How does the JavaScript Event Loop handle Promises compared to setTimeout callbacks?",
    correct_answer: "Promise callbacks execute in the Microtask Queue before Macrotasks like setTimeout callbacks.",
    distractors: [
      "Promise callbacks and setTimeout callbacks are processed in the same queue on a FIFO basis.",
      "setTimeout callbacks have higher priority and execute ahead of any pending Promise handlers.",
      "Promise callbacks run on a separate background worker thread to prevent blocking the Event Loop."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "JavaScript",
    archetype: "Anti-patterns",
    question: "Why is modifying `Array.prototype` considered a severe anti-pattern in modern JavaScript?",
    correct_answer: "It causes namespace collisions and breaks third-party library loops that use for...in statements.",
    distractors: [
      "It disables the browser garbage collector and immediately causes persistent memory leaks.",
      "It makes the JavaScript engine switch from JIT compilation back to pure bytecode interpretation.",
      "It restricts arrays from holding primitive types and forces all subsequent arrays to store objects."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "JavaScript",
    archetype: "Debugging",
    question: "What is the primary difference between `Object.freeze()` and `Object.seal()` in JavaScript?",
    correct_answer: "Object.freeze() makes existing properties read-only, whereas Object.seal() allows modifying existing values.",
    distractors: [
      "Object.seal() prevents reading properties, whereas Object.freeze() encrypts the object prototype in memory.",
      "Object.freeze() applies recursively to nested objects, whereas Object.seal() is strictly shallow.",
      "Object.seal() deletes all prototype methods, whereas Object.freeze() retains existing inheritance chains."
    ],
    difficulty: "Hard",
  },

  // TypeScript
  {
    skillName: "TypeScript",
    archetype: "Code Tracing",
    question: "What is the key functional difference between `unknown` and `any` in TypeScript?",
    correct_answer: "Values of type `unknown` require explicit type narrowing before you can perform operations on them.",
    distractors: [
      "Values of type `unknown` cannot be assigned to any variable, including variables of type `any`.",
      "Values of type `any` are strictly checked at compile time, whereas `unknown` bypasses the type checker.",
      "Values of type `unknown` are automatically converted to `null` if no type guard is evaluated at runtime."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "TypeScript",
    archetype: "System Design",
    question: "When should you prefer an `interface` over a `type` alias in large TypeScript codebases?",
    correct_answer: "When you need declaration merging for library extensions or building extensible object schemas.",
    distractors: [
      "When you need to define union types, tuple types, or map primitive type aliases across files.",
      "When you want TypeScript to compile the definition into an actual JavaScript runtime class object.",
      "When you need strict immutability because interfaces make all nested fields readonly by default."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "TypeScript",
    archetype: "Anti-patterns",
    question: "Why is excessive use of the non-null assertion operator (`!`) considered an anti-pattern in TypeScript?",
    correct_answer: "It silences compiler safety checks without guaranteeing runtime existence, leading to TypeError crashes.",
    distractors: [
      "It increases the bundled JavaScript output size by generating redundant runtime null-check functions.",
      "It forces the compiler to convert the target property into a mutable global window variable.",
      "It invalidates the TypeScript abstract syntax tree and causes the build process to run single-threaded."
    ],
    difficulty: "Easy",
  },

  // React
  {
    skillName: "React",
    archetype: "Code Tracing",
    question: "What happens when you update state multiple times synchronously inside a standard React 18 event handler?",
    correct_answer: "React batches the state updates automatically and executes a single consolidated re-render.",
    distractors: [
      "React triggers an immediate synchronous re-render for every individual state setter invocation.",
      "React drops all earlier updates and only applies the final state setter call in the function.",
      "React queues the updates in the microtask queue, causing infinite loop warnings in the console."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "React",
    archetype: "Debugging",
    question: "Why does an effect with a missing dependency array cause performance degradation in React?",
    correct_answer: "The effect runs after every single render cycle, creating redundant computations and network calls.",
    distractors: [
      "The effect locks the JavaScript call stack and prevents subsequent event loop macrotasks from running.",
      "The effect causes React to unmount and completely recreate the DOM node on every state update.",
      "The effect automatically converts all local useState variables into immutable useRef references."
    ],
    difficulty: "Easy",
  },
  {
    skillName: "React",
    archetype: "System Design",
    question: "What is the primary motivation for using `useCallback` when passing callbacks to child components?",
    correct_answer: "To prevent unnecessary re-renders of child components that are wrapped with `React.memo`.",
    distractors: [
      "To run the callback function on a separate Web Worker thread without blocking the browser UI thread.",
      "To automatically memoize the calculated return value of the function across subsequent renders.",
      "To persist the function state in the browser's localStorage across user page refreshes."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "React",
    archetype: "Anti-patterns",
    question: "Why is using array index as the `key` prop in dynamic lists considered an anti-pattern in React?",
    correct_answer: "It corrupts component state and breaks reconciliation when items are reordered, inserted, or deleted.",
    distractors: [
      "It causes React to throw a fatal unhandled runtime exception and abort the rendering pipeline.",
      "It disables virtual DOM diffing and forces React to make direct synchronous DOM queries on every tick.",
      "It forces the entire list container to recalculate layout geometry on every CSS hover transition."
    ],
    difficulty: "Medium",
  },

  // Node.js
  {
    skillName: "Node.js",
    archetype: "System Design",
    question: "How does Node.js handle CPU-bound tasks without blocking the main event loop?",
    correct_answer: "By offloading tasks to Worker Threads or delegating intensive crypto/fs operations to libuv.",
    distractors: [
      "By automatically allocating a dedicated physical OS thread for every incoming HTTP connection.",
      "By pausing incoming network requests until the main single thread finishes the computation.",
      "By converting the JavaScript bytecode into WebAssembly modules on the fly during execution."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "Node.js",
    archetype: "Debugging",
    question: "What is the risk of an unhandled Promise rejection in modern Node.js applications?",
    correct_answer: "It triggers the `unhandledRejection` event and terminates the Node.js process with a non-zero exit code.",
    distractors: [
      "It silently logs a warning to stderr and continues server execution without any side effects.",
      "It converts the rejected Promise into a resolved Promise with an undefined payload.",
      "It restarts the operating system network stack to clear pending socket descriptors."
    ],
    difficulty: "Easy",
  },
  {
    skillName: "Node.js",
    archetype: "Code Tracing",
    question: "What is the execution order of `process.nextTick()`, `Promise.then()`, and `setImmediate()` in Node.js?",
    correct_answer: "`process.nextTick()` runs first, followed by `Promise.then()` microtasks, then `setImmediate()` in check phase.",
    distractors: [
      "`setImmediate()` runs first, followed by `process.nextTick()`, then `Promise.then()` microtasks.",
      "`Promise.then()` microtasks run first, followed by `setImmediate()`, then `process.nextTick()`.",
      "All three run concurrently in parallel threads managed by the libuv default thread pool."
    ],
    difficulty: "Hard",
  },

  // Python
  {
    skillName: "Python",
    archetype: "Code Tracing",
    question: "What is the danger of using a mutable object (like a list or dict) as a default argument in Python functions?",
    correct_answer: "The default value is evaluated once when the function is defined and shared across all subsequent invocations.",
    distractors: [
      "Python raises a `TypeError: mutable default argument not permitted` immediately during module loading.",
      "The function automatically deep-copies the argument on each invocation, causing high memory overhead.",
      "The mutable object becomes a read-only frozen set that prevents any in-place item assignments."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "Python",
    archetype: "System Design",
    question: "What is the role of Python's Global Interpreter Lock (GIL) in standard CPython?",
    correct_answer: "It synchronizes thread execution so only one native thread executes Python bytecode at a time.",
    distractors: [
      "It prevents asynchronous asyncio coroutines from scheduling network I/O on multiple sockets.",
      "It locks the database connection pool to guarantee strict serializable ACID transactions.",
      "It compiles Python source code into native machine assembly ahead of script execution."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "Python",
    archetype: "Debugging",
    question: "How does Python's memory management reclaim objects involved in circular references?",
    correct_answer: "CPython uses a generational cyclic garbage collector in addition to standard reference counting.",
    distractors: [
      "CPython relies solely on reference counting and cannot reclaim memory from cyclic references.",
      "CPython automatically breaks reference cycles by replacing circular pointers with None values.",
      "CPython offloads cyclic reference resolution to operating system virtual memory paging."
    ],
    difficulty: "Hard",
  },

  // SQL & Databases
  {
    skillName: "SQL",
    archetype: "System Design",
    question: "What is the primary difference between a clustered index and a non-clustered index in relational databases?",
    correct_answer: "A clustered index defines the physical order of table rows, while a non-clustered index stores pointers to rows.",
    distractors: [
      "A clustered index is stored entirely in memory, while a non-clustered index is stored on disk.",
      "A non-clustered index allows duplicate keys, while a clustered index strictly prohibits any indexes.",
      "A clustered index can be created multiple times per table, while a non-clustered index is limited to one."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "SQL",
    archetype: "Anti-patterns",
    question: "Why is executing queries with `SELECT *` considered an anti-pattern in production web applications?",
    correct_answer: "It increases network I/O, prevents index-only covered scans, and causes schema drift vulnerabilities.",
    distractors: [
      "It invalidates the database transaction log and forces the database engine to acquire a table lock.",
      "It disables query caching on the database server and causes immediate connection pool exhaustion.",
      "It forces the database engine to convert all text columns into base64 strings before returning."
    ],
    difficulty: "Easy",
  },

  // MongoDB
  {
    skillName: "MongoDB",
    archetype: "System Design",
    question: "When designing a MongoDB schema, when is referencing (normalized) preferred over embedding (denormalized)?",
    correct_answer: "When representing unbounded one-to-many relationships or frequently updated shared data.",
    distractors: [
      "When you need maximum read performance and all child data is always retrieved with the parent document.",
      "When the child array will contain a fixed small number of items that never grow beyond a few entries.",
      "When you want to avoid using MongoDB indexes and rely exclusively on in-memory linear collection scans."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "MongoDB",
    archetype: "Debugging",
    question: "What does the MongoDB `$lookup` stage do in an aggregation pipeline?",
    correct_answer: "It performs an equality left outer join to a collection in the same database to filter/enrich documents.",
    distractors: [
      "It performs a full-text regex search across all indexed string fields in the collection.",
      "It calculates running moving averages across timeseries documents in chronological order.",
      "It exports the matched aggregation documents into an external CSV backup file on disk."
    ],
    difficulty: "Easy",
  },

  // Git & DevOps
  {
    skillName: "Git",
    archetype: "Code Tracing",
    question: "What is the primary difference between `git merge` and `git rebase`?",
    correct_answer: "`git rebase` rewrites project history by replaying commits onto a new base, while `git merge` creates a merge commit.",
    distractors: [
      "`git merge` deletes the source branch after combining changes, while `git rebase` leaves both branches intact.",
      "`git rebase` can only be executed on remote tracking branches, while `git merge` is strictly local.",
      "`git merge` preserves only the latest commit, whereas `git rebase` discards all uncommitted working changes."
    ],
    difficulty: "Medium",
  },
  {
    skillName: "DevOps",
    archetype: "System Design",
    question: "What is the primary benefit of multi-stage Docker builds for web application deployments?",
    correct_answer: "They separate build dependencies from runtime environments, drastically reducing final image size and attack surface.",
    distractors: [
      "They allow containers to run multiple operating system kernels concurrently on a single physical server.",
      "They automatically provision Kubernetes load balancers and configure DNS records during container boot.",
      "They encrypt container file systems at rest using hardware-backed cryptographic keys."
    ],
    difficulty: "Medium",
  },
];

/**
 * Ensures foundational question bank data exists on startup.
 */
const seedInitialQuestionBankIfEmpty = async () => {
  try {
    const count = await QuestionBank.countDocuments();
    if (count === 0) {
      console.log(`[QuestionBank] Seeding ${SEED_QUESTIONS.length} foundational questions...`);
      await QuestionBank.insertMany(SEED_QUESTIONS);
      console.log("[QuestionBank] Initial seed completed successfully.");
    }
  } catch (err) {
    console.warn("[QuestionBank] Seeding note:", err.message);
  }
};

/**
 * Phase 3: Cache Miss Handler using Gemini LLM.
 * Generates 5 unique questions for a skill and caches them to MongoDB.
 */
const generateAndCacheQuestions = async (skillName) => {
  if (!skillName || typeof skillName !== "string") {
    return [];
  }

  const cleanSkill = skillName.trim();
  const selectedArchetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!geminiKey) {
    console.warn("[QuestionBank] No Gemini API key found. Skipping LLM generation for:", cleanSkill);
    return [];
  }

  const prompt = `You are an expert technical interviewer. Generate 5 unique multiple-choice questions for the skill: ${cleanSkill}. Use the ${selectedArchetype} format. The correct answer MUST be roughly the same character length as the distractors. Output ONLY a raw JSON array matching this schema: [{"question": "...", "correct_answer": "...", "distractors": ["...", "...", "..."]}]`;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent(prompt);
    const rawText = (result.response.text() || "").replace(/```json|```/g, "").trim();

    let parsedQuestions = [];
    try {
      const parsed = JSON.parse(rawText);
      parsedQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.mcqs || []);
    } catch (jsonErr) {
      console.error(`[QuestionBank] JSON parse error for skill ${cleanSkill}:`, jsonErr.message);
      return [];
    }

    // Filter valid questions matching schema
    const validQuestionsToSave = [];
    for (const q of parsedQuestions) {
      if (
        q &&
        typeof q.question === "string" &&
        q.question.trim().length > 10 &&
        typeof q.correct_answer === "string" &&
        q.correct_answer.trim().length > 0 &&
        Array.isArray(q.distractors) &&
        q.distractors.length >= 3
      ) {
        validQuestionsToSave.push({
          skillName: cleanSkill,
          archetype: selectedArchetype,
          question: q.question.trim(),
          correct_answer: q.correct_answer.trim(),
          distractors: q.distractors.map((d) => String(d).trim()),
          difficulty: "Medium",
        });
      }
    }

    if (validQuestionsToSave.length > 0) {
      const inserted = await QuestionBank.insertMany(validQuestionsToSave);
      console.log(`[QuestionBank CACHE SAVE] Cached ${inserted.length} questions for skill: "${cleanSkill}" (Archetype: ${selectedArchetype})`);
      return inserted;
    }

    return [];
  } catch (llmErr) {
    console.error(`[QuestionBank LLM Error] Failed generating questions for ${cleanSkill}:`, llmErr.message);
    return [];
  }
};

/**
 * Phase 4: Shuffles options with Fisher-Yates and calculates correct index.
 */
const formatAndRandomizeQuestion = (qDoc, section = "Core") => {
  const distractors = Array.isArray(qDoc.distractors) ? qDoc.distractors : [];
  const correctAnswer = qDoc.correct_answer || "Option A";

  // Merge correct answer and distractors (3 distractors + 1 correct = 4 options)
  const combinedOptions = [correctAnswer, ...distractors.slice(0, 3)];

  // Shuffle combined options with Fisher-Yates
  const shuffledOptions = shuffleArray(combinedOptions);
  const correctOptionIndex = shuffledOptions.indexOf(correctAnswer);

  return {
    questionText: qDoc.question,
    options: shuffledOptions,
    correctOption: correctOptionIndex !== -1 ? correctOptionIndex : 0,
    skill: qDoc.skillName || "Technical",
    difficulty: qDoc.difficulty || "Medium",
    archetype: qDoc.archetype || "Core Concepts",
    section,
  };
};

/**
 * Phase 2 & 3 & 4: Dynamic Question Assembly with Skill-Bank Caching Strategy.
 * Assembles questionCount questions for requiredSkills from MongoDB QuestionBank.
 * Triggers LLM cache miss if fewer questions than needed exist.
 */
const assembleExam = async (requiredSkills = [], questionCount = 35, jdRatio = 0.70) => {
  await seedInitialQuestionBankIfEmpty();

  const cleanSkills = [...new Set(
    (Array.isArray(requiredSkills) ? requiredSkills : [])
      .map((s) => (typeof s === "string" ? s.trim() : s?.name || s?.skill || ""))
      .filter((s) => s && s.length > 1)
  )];

  const effectiveSkills = cleanSkills.length > 0
    ? cleanSkills
    : ["JavaScript", "Node.js", "React", "Python", "SQL", "Git", "DevOps"];

  const coreQuota = Math.max(1, Math.round(questionCount * jdRatio));
  const electiveQuota = Math.max(1, questionCount - coreQuota);

  const coreSkills = effectiveSkills.slice(0, Math.max(1, Math.ceil(effectiveSkills.length * 0.6)));
  const electiveSkills = effectiveSkills.length > coreSkills.length
    ? effectiveSkills.slice(coreSkills.length)
    : coreSkills;

  const pullSkillQuestions = async (targetSkills, quota, sectionName) => {
    const selectedQuestionDocs = [];
    const usedQuestionTexts = new Set();
    const perSkillTarget = Math.max(1, Math.ceil(quota / targetSkills.length));

    for (const skill of targetSkills) {
      if (selectedQuestionDocs.length >= quota) break;

      const needed = Math.min(perSkillTarget, quota - selectedQuestionDocs.length);

      // Query QuestionBank using $match and $sample
      const skillRegex = new RegExp(`^${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
      let matched = await QuestionBank.aggregate([
        { $match: { skillName: { $regex: skillRegex } } },
        { $sample: { size: needed * 2 } },
      ]);

      // Cache Miss: If not enough questions in DB, trigger Gemini generation
      if (matched.length < needed) {
        console.log(`[QuestionBank CACHE MISS] Skill: "${skill}". Found ${matched.length}/${needed}. Triggering Gemini LLM...`);
        const newlyGenerated = await generateAndCacheQuestions(skill);
        if (newlyGenerated.length > 0) {
          // Re-fetch sample after caching
          matched = await QuestionBank.aggregate([
            { $match: { skillName: { $regex: skillRegex } } },
            { $sample: { size: needed * 2 } },
          ]);
        }
      }

      for (const doc of matched) {
        if (!usedQuestionTexts.has(doc.question) && selectedQuestionDocs.length < quota) {
          usedQuestionTexts.add(doc.question);
          selectedQuestionDocs.push({ ...doc, section: sectionName });
        }
      }
    }

    // If quota still not met, sample from general pool in QuestionBank
    if (selectedQuestionDocs.length < quota) {
      const remainingNeeded = quota - selectedQuestionDocs.length;
      const fallbackDocs = await QuestionBank.aggregate([
        { $match: { question: { $nin: Array.from(usedQuestionTexts) } } },
        { $sample: { size: remainingNeeded } },
      ]);

      for (const doc of fallbackDocs) {
        if (!usedQuestionTexts.has(doc.question) && selectedQuestionDocs.length < quota) {
          usedQuestionTexts.add(doc.question);
          selectedQuestionDocs.push({ ...doc, section: sectionName });
        }
      }
    }

    return selectedQuestionDocs.map((doc) => formatAndRandomizeQuestion(doc, sectionName));
  };

  const [coreQuestions, electiveQuestions] = await Promise.all([
    pullSkillQuestions(coreSkills, coreQuota, "Core"),
    pullSkillQuestions(electiveSkills, electiveQuota, "Elective"),
  ]);

  const assembled = [...coreQuestions, ...electiveQuestions].slice(0, questionCount);

  // If assembled is still short due to empty collection, fallback to seed
  if (assembled.length < questionCount) {
    const backupFormatted = SEED_QUESTIONS.map((q) => formatAndRandomizeQuestion(q, "Core"));
    for (const bq of backupFormatted) {
      if (assembled.length >= questionCount) break;
      if (!assembled.some((a) => a.questionText === bq.questionText)) {
        assembled.push(bq);
      }
    }
  }

  console.log(`[QuestionBank] Assembled ${assembled.length} exam questions (${coreQuestions.length} Core, ${electiveQuestions.length} Elective). Token-free DB hit.`);
  return assembled.slice(0, questionCount);
};

module.exports = {
  ARCHETYPES,
  seedInitialQuestionBankIfEmpty,
  generateAndCacheQuestions,
  assembleExam,
  formatAndRandomizeQuestion,
};
