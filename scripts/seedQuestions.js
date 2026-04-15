const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Question = require("../models/Question");

dotenv.config({ path: "../.env" });

const questions = [
  // React
  {
    category: "React", difficulty: "Easy",
    text: "What is the primary purpose of the Virtual DOM in React?",
    options: ["To directly manipulate the browser DOM", "To increase memory usage", "To optimize rendering performance by comparing state changes", "To write inline CSS"],
    correctIndex: 2
  },
  {
    category: "React", difficulty: "Medium",
    text: "Which hook should be used to memoize an expensive computation function between renders?",
    options: ["useCallback", "useMemo", "useRef", "useEffect"],
    correctIndex: 1
  },
  {
    category: "React", difficulty: "Hard",
    text: "How does React 18's automatic batching improve performance?",
    options: ["It combines multiple state updates into a single re-render, even inside promises and timeouts.", "It automatically chunks JavaScript bundles.", "It batches database queries into a single GraphQL request.", "It compiles components into WebAssembly."],
    correctIndex: 0
  },
  
  // Node.js
  {
    category: "Node.js", difficulty: "Easy",
    text: "Which core Node.js module is used to handle file system operations?",
    options: ["http", "path", "fs", "os"],
    correctIndex: 2
  },
  {
    category: "Node.js", difficulty: "Medium",
    text: "What is the primary mechanism that allows Node.js to perform non-blocking I/O operations?",
    options: ["Multi-threading", "The Event Loop utilizing libuv", "Child processes", "V8 Engine caching"],
    correctIndex: 1
  },
  {
    category: "Node.js", difficulty: "Hard",
    text: "In Node.js Streams, which type of stream allows both reading and writing, but where the output is computed from the input?",
    options: ["Duplex Stream", "Transform Stream", "Writable Stream", "Observable Stream"],
    correctIndex: 1
  },

  // Databases (MongoDB/SQL)
  {
    category: "Database", difficulty: "Easy",
    text: "In MongoDB, a single record is referred to as a...",
    options: ["Row", "Document", "Collection", "Node"],
    correctIndex: 1
  },
  {
    category: "Database", difficulty: "Medium",
    text: "In SQL, what is the primary difference between a clustered and non-clustered index?",
    options: ["A clustered index dictates the physical storage order of the data in the table.", "A clustered index can only be applied to string columns.", "Non-clustered indexes are automatically generated for primary keys.", "Clustered indexes are slower for range queries."],
    correctIndex: 0
  },
  {
    category: "Database", difficulty: "Hard",
    text: "What does the 'Consistency' guarantee in the CAP theorem imply during a network partition?",
    options: ["All nodes see the exact same data at the exact same time.", "Operations will eventually succeed.", "The database will never refuse a read request.", "Data is backed up consistently across geographical regions."],
    correctIndex: 0
  },

  // Security / Networking
  {
    category: "Security", difficulty: "Easy",
    text: "What does HTTPS use to encrypt data transmitted between the client and server?",
    options: ["MD5", "TLS/SSL", "Base64 encoding", "RSA strictly"],
    correctIndex: 1
  },
  {
    category: "Security", difficulty: "Medium",
    text: "How does a Cross-Site Request Forgery (CSRF) attack typically function?",
    options: ["By injecting malicious scripts into the database.", "By brute-forcing standard credentials.", "By tricking an authenticated user's browser into executing unwanted actions on a trusted site.", "By exploiting buffer overflows in the backend."],
    correctIndex: 2
  },
  {
    category: "Security", difficulty: "Hard",
    text: "When implementing JSON Web Tokens (JWT), what is the intrinsic vulnerability if the 'alg' header is set to 'none' by a malicious client?",
    options: ["The server might bypass signature verification completely.", "The token payload gets compressed.", "The server will crash due to unhandled exceptions.", "The symmetric key is leaked to the client."],
    correctIndex: 0
  }
];

const seedDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/veriproof";
    await mongoose.connect(mongoUri);
    console.log("Connected to DB...");

    await Question.deleteMany();
    console.log("Wiped old questions...");

    await Question.insertMany(questions);
    console.log(`Injected ${questions.length} questions successfully!`);

    process.exit();
  } catch (error) {
    console.error("Seeding error:", error);
    process.exit(1);
  }
};

seedDB();
