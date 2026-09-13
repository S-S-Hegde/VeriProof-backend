const QuestionBank = require("../models/QuestionBank");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { shuffleArray: qpShuffle } = require("./questionQualityPipeline");

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

// ══════════════════════════════════════════════════════════════════════
// SEED QUESTIONS — High-quality baseline across common skills
// ══════════════════════════════════════════════════════════════════════

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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 2,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 4,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 2,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 2,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 2,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 4,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 4,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 2,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 2,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
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
    difficultyTier: 3,
    category: "calibration",
    scenarioType: "conceptual",
  },
];

// ══════════════════════════════════════════════════════════════════════
// TRAP QUESTION SEED BANK — Handcrafted Anti-Memorization Questions
// ══════════════════════════════════════════════════════════════════════
// These questions have a "textbook" answer (the trap bait) and a
// "production-safe" correct answer. Memorizers pick the textbook answer.

const TRAP_QUESTIONS = [
  // React Traps
  {
    skillName: "React",
    archetype: "Anti-patterns",
    question: "A React component fetches data in useEffect and stores it in state. During code review, a colleague suggests adding the API URL to the dependency array since it's referenced inside the effect. What should you do?",
    correct_answer: "Evaluate whether the URL actually changes. If it's a static constant, adding it creates zero behavior difference but misleads future developers.",
    distractors: [
      "Always add every referenced variable to the dependency array to satisfy the exhaustive-deps ESLint rule without exceptions.",
      "Remove the dependency array entirely so the effect synchronizes with every external reference automatically.",
      "Wrap the URL in a useRef to bypass the dependency array requirement and prevent unnecessary re-fetches."
    ],
    difficulty: "Hard",
    difficultyTier: 4,
    category: "trap",
    scenarioType: "conceptual",
    isTrapQuestion: true,
    trapBaitIndex: 0, // The "textbook" answer that memorizers pick (always add to dep array)
    trapExplanation: "The textbook answer is 'always add every dependency.' But in production, a static URL never changes, so adding it is meaningless. Real engineers evaluate context rather than blindly following lint rules.",
  },
  {
    skillName: "React",
    archetype: "Debugging",
    question: "Your React app renders a list of 10,000 items. Performance is sluggish. A junior developer suggests using React.memo on every list item component. Is this the right approach?",
    correct_answer: "React.memo helps only if props actually change infrequently. For 10K items, virtualization (react-window) is the correct primary optimization.",
    distractors: [
      "Yes, wrapping every component with React.memo is the standard best practice for any list performance issue in React applications.",
      "No, React.memo is deprecated in React 18 and should be replaced with the useDeferredValue hook for all list scenarios.",
      "No, use shouldComponentUpdate instead because React.memo is only designed for class-based components in legacy codebases."
    ],
    difficulty: "Hard",
    difficultyTier: 4,
    category: "trap",
    scenarioType: "conceptual",
    isTrapQuestion: true,
    trapBaitIndex: 0, // Memorizers pick "yes, React.memo is best practice"
    trapExplanation: "Textbook says React.memo optimizes performance. Production reality: for 10K items, memo's shallow comparison on 10K components is itself expensive. Virtualization solves the root cause.",
  },

  // Node.js Traps
  {
    skillName: "Node.js",
    archetype: "System Design",
    question: "Your Node.js Express API occasionally returns 502 errors under load. A team member suggests increasing the server's timeout value. What's your assessment?",
    correct_answer: "Increasing timeout masks the root cause. Profile the slow endpoints first — likely a blocking operation, unoptimized query, or missing connection pooling.",
    distractors: [
      "Increasing the timeout is the correct first step because 502 errors are caused by premature connection termination from short timeouts.",
      "Replace Express entirely with Fastify because Express cannot handle concurrent requests due to its synchronous middleware pipeline.",
      "Add a load balancer in front of the server because single Node.js instances are limited to 100 concurrent TCP connections by design."
    ],
    difficulty: "Hard",
    difficultyTier: 4,
    category: "trap",
    scenarioType: "conceptual",
    isTrapQuestion: true,
    trapBaitIndex: 0, // Memorizers pick "increase timeout"
    trapExplanation: "Textbook fix: increase timeout. Production reality: timeout increases mask slow code, accumulate connection backpressure, and eventually cause cascading failures.",
  },
  {
    skillName: "Node.js",
    archetype: "Debugging",
    question: "A Node.js microservice has a memory leak. The heap grows by ~50MB per hour. A developer suggests calling `global.gc()` periodically to fix it. Is this viable?",
    correct_answer: "No. Forcing GC treats the symptom, not the cause. Use heap snapshots via --inspect to find the retained objects and fix the reference leak.",
    distractors: [
      "Yes, calling global.gc() periodically is a standard production technique to manage heap pressure in long-running Node.js services.",
      "No, global.gc() only works on the old generation heap and cannot affect new generation allocations where most leaks occur.",
      "Yes, but only if combined with --max-old-space-size=4096 to give the garbage collector sufficient room to operate efficiently."
    ],
    difficulty: "Hard",
    difficultyTier: 4,
    category: "trap",
    scenarioType: "conceptual",
    isTrapQuestion: true,
    trapBaitIndex: 0,
    trapExplanation: "Forcing GC is a bandaid. Production engineers trace the leak source using heap snapshots rather than periodically cleaning up symptoms.",
  },

  // SQL Traps
  {
    skillName: "SQL",
    archetype: "System Design",
    question: "A production PostgreSQL query that joins 3 tables is slow (~4 seconds). A DBA suggests adding an index on every column used in WHERE and JOIN clauses. Is this the right approach?",
    correct_answer: "No. Analyze the query plan with EXPLAIN ANALYZE first. Over-indexing degrades write performance and increases storage. Target only the bottleneck columns.",
    distractors: [
      "Yes, indexing every column referenced in WHERE and JOIN conditions is the standard PostgreSQL optimization practice for multi-table joins.",
      "No, indexes don't help joins in PostgreSQL. Use materialized views instead because they pre-compute join results for instant retrieval.",
      "Yes, but only B-tree indexes. Hash and GIN indexes are incompatible with multi-column join operations in PostgreSQL versions below 16."
    ],
    difficulty: "Hard",
    difficultyTier: 4,
    category: "trap",
    scenarioType: "conceptual",
    isTrapQuestion: true,
    trapBaitIndex: 0,
    trapExplanation: "Textbook: add indexes everywhere. Production: over-indexing hammers write performance (INSERT/UPDATE) and wastes disk. EXPLAIN ANALYZE reveals which specific scan is the bottleneck.",
  },
  {
    skillName: "SQL",
    archetype: "Debugging",
    question: "A query returns correct results in development but wrong results in production. The tables are identical. A developer suspects index corruption. What should you check first?",
    correct_answer: "Check for implicit type coercion, collation differences, or timezone settings between dev and prod database configurations.",
    distractors: [
      "Run REINDEX on all tables because index corruption is the most common cause of result discrepancies between identical databases.",
      "Enable query logging and compare exact query plans because different PostgreSQL versions generate different join strategies.",
      "Check if production is using read replicas with replication lag causing stale data to be returned from secondary nodes."
    ],
    difficulty: "Hard",
    difficultyTier: 4,
    category: "trap",
    scenarioType: "conceptual",
    isTrapQuestion: true,
    trapBaitIndex: 0,
    trapExplanation: "Index corruption is extremely rare. The vastly more common cause: different collation, timezone, or implicit type coercion settings between environments.",
  },

  // Python Traps
  {
    skillName: "Python",
    archetype: "System Design",
    question: "Your Python web API handles 200 req/s but needs to scale to 2000 req/s. A developer suggests rewriting the synchronous Flask app to async using asyncio. Is this the right path?",
    correct_answer: "Only if the bottleneck is I/O-bound. If it's CPU-bound (data processing, ML inference), asyncio won't help — use multiprocessing or offload to a task queue.",
    distractors: [
      "Yes, converting to asyncio is the correct approach because async Python always handles 10x more concurrent requests than synchronous frameworks.",
      "No, Python's GIL makes async completely useless for web servers. Use Golang or Rust for any application exceeding 500 requests per second.",
      "Yes, but only by switching to FastAPI because Flask is architecturally incompatible with Python's asyncio event loop implementation."
    ],
    difficulty: "Hard",
    difficultyTier: 4,
    category: "trap",
    scenarioType: "conceptual",
    isTrapQuestion: true,
    trapBaitIndex: 0,
    trapExplanation: "Textbook: async = faster. Production: async only helps I/O-bound workloads. If your bottleneck is CPU (which is common in data-heavy APIs), asyncio changes nothing.",
  },

  // JavaScript Traps
  {
    skillName: "JavaScript",
    archetype: "Debugging",
    question: "A JavaScript application has intermittent 'Maximum call stack size exceeded' errors. A developer suggests increasing the Node.js stack size with --stack-size. Is this a valid fix?",
    correct_answer: "No. Increasing stack size delays the crash but doesn't fix the unbounded recursion. Rewrite the recursive logic to use iteration or trampolining.",
    distractors: [
      "Yes, increasing the stack size is the standard solution for deep recursion in production Node.js applications handling complex data structures.",
      "No, use tail call optimization instead because V8 automatically optimizes recursive functions marked with 'use strict' at the module level.",
      "Yes, but only in combination with worker threads because the main thread has a hardcoded stack limit that the flag cannot override."
    ],
    difficulty: "Hard",
    difficultyTier: 4,
    category: "trap",
    scenarioType: "conceptual",
    isTrapQuestion: true,
    trapBaitIndex: 0,
    trapExplanation: "Textbook: increase the limit. Production: this masks infinite/unbounded recursion. V8 does NOT implement TCO despite spec support. Fix the algorithm.",
  },

  // MongoDB Traps
  {
    skillName: "MongoDB",
    archetype: "System Design",
    question: "Your MongoDB collection has 50M documents. Queries filtering by `status` field are slow. A developer suggests adding a single-field index on `status`. The field has only 3 possible values. Is this effective?",
    correct_answer: "Low-cardinality indexes (3 values across 50M docs) are largely ineffective. Use a compound index with a high-cardinality field or restructure the query pattern.",
    distractors: [
      "Yes, any field used in query filters should be indexed regardless of cardinality to eliminate full collection scans in MongoDB.",
      "No, MongoDB automatically indexes all fields with fewer than 10 distinct values using its internal bloom filter optimization.",
      "Yes, but only if you use a hashed index type because standard B-tree indexes cannot efficiently handle low-cardinality string fields."
    ],
    difficulty: "Hard",
    difficultyTier: 4,
    category: "trap",
    scenarioType: "conceptual",
    isTrapQuestion: true,
    trapBaitIndex: 0,
    trapExplanation: "Textbook: index everything you query. Production: a 3-value index on 50M docs means each index entry points to ~17M documents — the index scan is nearly as slow as a collection scan.",
  },
];

/**
 * Ensures foundational question bank data exists on startup.
 */
const seedInitialQuestionBankIfEmpty = async () => {
  try {
    const count = await QuestionBank.countDocuments();
    if (count === 0) {
      const allSeeds = [...SEED_QUESTIONS, ...TRAP_QUESTIONS];
      console.log(`[QuestionBank] Seeding ${allSeeds.length} foundational + trap questions...`);
      await QuestionBank.insertMany(allSeeds);
      console.log("[QuestionBank] Initial seed completed successfully.");
    } else {
      // Ensure trap questions are seeded even if regular seeds exist
      const trapCount = await QuestionBank.countDocuments({ isTrapQuestion: true });
      if (trapCount === 0 && TRAP_QUESTIONS.length > 0) {
        console.log(`[QuestionBank] Seeding ${TRAP_QUESTIONS.length} trap questions...`);
        await QuestionBank.insertMany(TRAP_QUESTIONS);
        console.log("[QuestionBank] Trap question seed completed.");
      }
    }
  } catch (err) {
    console.warn("[QuestionBank] Seeding note:", err.message);
  }
};

/**
 * Phase 3: Cache Miss Handler using Gemini LLM.
 * Generates 5 unique questions for a skill and caches them to MongoDB.
 */
const generateAndCacheQuestions = async (skillName, targetDifficulty = "Medium") => {
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

  const tierMap = { "Easy": 2, "Medium": 3, "Hard": 4 };
  const difficultyTier = tierMap[targetDifficulty] || 3;

  const prompt = `You are an expert technical interviewer. Generate 5 unique multiple-choice questions for the skill: ${cleanSkill} at ${targetDifficulty} difficulty level. Use the ${selectedArchetype} format.

CRITICAL RULES FOR OPTION LENGTH:
1. The correct answer MUST be roughly the same character length as the distractors (within ±20%).
2. ALL options must use the same level of technical jargon.
3. ALL options must sound equally confident — no hedging in only one option.
4. Distractors must be PLAUSIBLE wrong answers, not obviously absurd.

Output ONLY a raw JSON array matching this schema: [{"question": "...", "correct_answer": "...", "distractors": ["...", "...", "..."]}]`;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
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
          difficulty: targetDifficulty,
          difficultyTier,
          category: "calibration",
          scenarioType: "conceptual",
          source: "llm",
        });
      }
    }

    if (validQuestionsToSave.length > 0) {
      const inserted = await QuestionBank.insertMany(validQuestionsToSave);
      console.log(`[QuestionBank CACHE SAVE] Cached ${inserted.length} questions for skill: "${cleanSkill}" (Archetype: ${selectedArchetype}, Difficulty: ${targetDifficulty})`);
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
const formatAndRandomizeQuestion = (qDoc, section = "Core", phase = "calibration") => {
  const distractors = Array.isArray(qDoc.distractors) ? qDoc.distractors : [];
  const correctAnswer = qDoc.correct_answer || "Option A";

  // Merge correct answer and distractors (3 distractors + 1 correct = 4 options)
  const combinedOptions = [correctAnswer, ...distractors.slice(0, 3)];

  // Shuffle combined options with Fisher-Yates
  const shuffledOptions = shuffleArray(combinedOptions);
  const correctOptionIndex = shuffledOptions.indexOf(correctAnswer);

  // For trap questions, find the trap bait index in shuffled array
  let trapBaitIndex = -1;
  if (qDoc.isTrapQuestion && qDoc.trapBaitIndex !== undefined && qDoc.trapBaitIndex >= 0) {
    // Original trapBaitIndex refers to the original distractors array
    // Distractor at index trapBaitIndex is the bait
    const baitText = qDoc.trapBaitIndex === 0
      ? distractors[0]
      : qDoc.trapBaitIndex <= distractors.length
        ? distractors[qDoc.trapBaitIndex - 1]  // offset since correct_answer was at index 0
        : distractors[0];
    // Actually, trapBaitIndex in our seed data refers to the distractor index (0-indexed in distractors array)
    const baitDistractor = distractors[qDoc.trapBaitIndex] || distractors[0];
    trapBaitIndex = shuffledOptions.indexOf(baitDistractor);
  }

  return {
    questionText: qDoc.question,
    options: shuffledOptions,
    correctOption: correctOptionIndex !== -1 ? correctOptionIndex : 0,
    skill: qDoc.skillName || "Technical",
    difficulty: qDoc.difficulty || "Medium",
    difficultyTier: qDoc.difficultyTier || 3,
    archetype: qDoc.archetype || "Core Concepts",
    section,
    phase,
    scenarioType: qDoc.scenarioType || "conceptual",
    codeSnippet: qDoc.codeSnippet || "",
    codeLanguage: qDoc.codeLanguage || "",
    isTrapQuestion: qDoc.isTrapQuestion || false,
    trapBaitIndex: trapBaitIndex,
  };
};

/**
 * Assemble a CALIBRATION ROUND (Part 1) with stratified difficulty sampling.
 *
 * Includes:
 * - Mix of Easy (30%), Medium (50%), Hard (20%) per skill
 * - 1-2 trap questions per skill (if enabled)
 * - Questions tagged with phase: "calibration"
 *
 * @param {string[]} requiredSkills - Skills to test
 * @param {number} questionCount - Total Part 1 questions
 * @param {boolean} includeTrapQuestions - Whether to include trap questions
 * @returns {Promise<Array>} Assembled calibration questions
 */
const assembleCalibrationRound = async (requiredSkills = [], questionCount = 10, includeTrapQuestions = true) => {
  await seedInitialQuestionBankIfEmpty();

  const cleanSkills = [...new Set(
    (Array.isArray(requiredSkills) ? requiredSkills : [])
      .map((s) => (typeof s === "string" ? s.trim() : s?.name || s?.skill || ""))
      .filter((s) => s && s.length > 1)
  )];

  const effectiveSkills = cleanSkills.length > 0
    ? cleanSkills
    : ["JavaScript", "Node.js", "React", "Python", "SQL"];

  const perSkillCount = Math.max(1, Math.ceil(questionCount / effectiveSkills.length));
  const assembled = [];
  const usedQuestionTexts = new Set();

  for (const skill of effectiveSkills) {
    if (assembled.length >= questionCount) break;

    const needed = Math.min(perSkillCount, questionCount - assembled.length);
    const skillRegex = new RegExp(`^${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

    // ── Stratified difficulty sampling: 30% Easy, 50% Medium, 20% Hard ──
    const easyCount = Math.max(1, Math.round(needed * 0.30));
    const hardCount = Math.max(0, Math.round(needed * 0.20));
    const mediumCount = needed - easyCount - hardCount;

    const pullByDifficulty = async (diffLevel, count) => {
      const results = [];
      const tierRange = diffLevel === "Easy" ? { $lte: 2 } : diffLevel === "Hard" ? { $gte: 4 } : { $gte: 2, $lte: 4 };

      let matched = await QuestionBank.aggregate([
        {
          $match: {
            skillName: { $regex: skillRegex },
            category: { $in: ["calibration", "any"] },
            isTrapQuestion: { $ne: true },
            difficultyTier: tierRange,
          },
        },
        { $sample: { size: count * 2 } },
      ]);

      // Cache miss: generate if not enough
      if (matched.length < count) {
        await generateAndCacheQuestions(skill, diffLevel);
        matched = await QuestionBank.aggregate([
          {
            $match: {
              skillName: { $regex: skillRegex },
              category: { $in: ["calibration", "any"] },
              isTrapQuestion: { $ne: true },
              difficultyTier: tierRange,
            },
          },
          { $sample: { size: count * 2 } },
        ]);
      }

      for (const doc of matched) {
        if (results.length >= count) break;
        if (!usedQuestionTexts.has(doc.question)) {
          usedQuestionTexts.add(doc.question);
          results.push(formatAndRandomizeQuestion(doc, "Core", "calibration"));
        }
      }

      return results;
    };

    const easyQ = await pullByDifficulty("Easy", easyCount);
    const medQ = await pullByDifficulty("Medium", mediumCount);
    const hardQ = await pullByDifficulty("Hard", hardCount);

    assembled.push(...easyQ, ...medQ, ...hardQ);

    // ── Include 1 trap question per skill (if enabled and available) ──
    if (includeTrapQuestions && assembled.length < questionCount) {
      const trapDocs = await QuestionBank.aggregate([
        {
          $match: {
            skillName: { $regex: skillRegex },
            isTrapQuestion: true,
          },
        },
        { $sample: { size: 1 } },
      ]);

      for (const doc of trapDocs) {
        if (assembled.length >= questionCount) break;
        if (!usedQuestionTexts.has(doc.question)) {
          usedQuestionTexts.add(doc.question);
          assembled.push(formatAndRandomizeQuestion(doc, "Core", "calibration"));
        }
      }
    }
  }

  // Fallback if still short
  if (assembled.length < questionCount) {
    const backupFormatted = SEED_QUESTIONS.map((q) => formatAndRandomizeQuestion(q, "Core", "calibration"));
    for (const bq of backupFormatted) {
      if (assembled.length >= questionCount) break;
      if (!assembled.some((a) => a.questionText === bq.questionText)) {
        assembled.push(bq);
      }
    }
  }

  // Shuffle the assembled questions so easy/medium/hard aren't in order
  const shuffled = shuffleArray(assembled.slice(0, questionCount));

  console.log(`[QuestionBank] Assembled ${shuffled.length} calibration questions (stratified difficulty) across ${effectiveSkills.length} skills.`);
  return shuffled;
};

/**
 * Legacy assembleExam function — still used for standard (non-adaptive) exams.
 * Preserved for backward compatibility.
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

      const skillRegex = new RegExp(`^${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
      let matched = await QuestionBank.aggregate([
        { $match: { skillName: { $regex: skillRegex } } },
        { $sample: { size: needed * 2 } },
      ]);

      if (matched.length < needed) {
        console.log(`[QuestionBank CACHE MISS] Skill: "${skill}". Found ${matched.length}/${needed}. Triggering Gemini LLM...`);
        const newlyGenerated = await generateAndCacheQuestions(skill);
        if (newlyGenerated.length > 0) {
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
  TRAP_QUESTIONS,
  seedInitialQuestionBankIfEmpty,
  generateAndCacheQuestions,
  assembleExam,
  assembleCalibrationRound,
  formatAndRandomizeQuestion,
};
