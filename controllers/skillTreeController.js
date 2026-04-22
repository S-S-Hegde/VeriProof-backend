const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const User = require("../models/User");
const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

// ─── Gemini Client (lazy-initialised on first call) ───────────────────────────
let genAI = null;
const getGenAI = () => {
  if (!genAI) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set in environment variables");
    genAI = new GoogleGenerativeAI(key);
  }
  return genAI;
};

// ─── JSON-Schema that Gemini MUST conform to ─────────────────────────────────
const skillNodeResponseSchema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      id:         { type: SchemaType.STRING,  description: "Unique lowercase hyphenated identifier (e.g. 'react', 'node-js')" },
      name:       { type: SchemaType.STRING,  description: "Human-readable display name" },
      category:   { type: SchemaType.STRING,  description: "One of: verified, foundational, recommended" },
      parentId:   { type: SchemaType.STRING,  description: "Parent node id, or null for root domains", nullable: true },
      confidence: { type: SchemaType.NUMBER,  description: "Confidence score 0-100" },
      evidence:   {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: "Evidence strings, e.g. 'GitHub: 5 repos using React', 'Resume: mentioned in work experience'",
      },
    },
    required: ["id", "name", "category", "parentId", "confidence", "evidence"],
  },
};

// ─── System prompt for the LLM ────────────────────────────────────────────────
const buildSystemPrompt = () => `You are a hiring-verification AI for the VeriProof platform.
Your task is to analyze a candidate's resume text and GitHub repository data,
then produce a hierarchical skill tree as a JSON array.

CATEGORY RULES (strict):
  • "verified"     — Strong evidence: skill appears in ≥ 2 GitHub repos OR is explicitly
                     mentioned in the resume AND backed by at least one GitHub repo.
                     Confidence range: 80–100.
  • "foundational" — Prerequisite knowledge implied by verified skills
                     (e.g. JavaScript is foundational if React is verified).
                     Confidence range: 60–79.
  • "recommended"  — Adjacent skills the candidate should learn next to round out
                     their profile for industry readiness. No current evidence.
                     Confidence range: 0–40.

HIERARCHY RULES:
  • Root nodes (parentId = null): broad domains — e.g. "Frontend", "Backend", "DevOps", "Data Science".
  • Level 2: specific technologies — e.g. "React", "Node.js", "Docker".
  • Level 3: sub-skills / frameworks — e.g. "Redux", "Express", "Kubernetes".
  • Every node must have a unique \`id\` (lowercase, hyphenated).
  • \`parentId\` must reference an existing node's \`id\`, or be null for roots.
  • Generate 15–30 nodes total. Do NOT exceed 30 nodes.
  • Ensure the tree is realistic and directly relevant to hiring verification.
    Do NOT include unrelated hobby skills or generic life skills.

OUTPUT: Return ONLY the JSON array. No markdown, no explanation.`;

// ─── Utility: SHA-256 hash of input data ──────────────────────────────────────
const hashInputData = (resumeText, githubData) => {
  const payload = JSON.stringify({ resumeText, githubData });
  return crypto.createHash("sha256").update(payload).digest("hex");
};

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Generate Skill Tree via LLM
// @route   POST /api/skill-tree/generate
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
const generateSkillTree = asyncHandler(async (req, res) => {
  const { resumeText, githubData } = req.body;

  if (!resumeText && !githubData) {
    res.status(400);
    throw new Error("At least one of resumeText or githubData is required");
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // ── Check if data has changed since last generation ──
  const inputHash = hashInputData(resumeText || "", githubData || {});

  if (user.skillTree?.sourceHash === inputHash && user.skillTree?.nodes?.length > 0) {
    return res.json({
      message: "Skill tree is already up-to-date",
      skillTree: user.skillTree,
      cached: true,
    });
  }

  // ── Build user prompt with actual data ──
  const userPrompt = `
CANDIDATE RESUME TEXT:
"""
${resumeText || "No resume text provided."}
"""

GITHUB REPOSITORY DATA (JSON):
"""
${JSON.stringify(githubData || {}, null, 2)}
"""

Analyze the above and generate the skill tree JSON array.`;

  // ── Call Gemini with structured output ──
  const ai = getGenAI();
  const model = ai.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: skillNodeResponseSchema,
      temperature: 0.4,
    },
    systemInstruction: buildSystemPrompt(),
  });

  const result = await model.generateContent(userPrompt);
  const responseText = result.response.text();

  let nodes;
  try {
    nodes = JSON.parse(responseText);
  } catch (parseError) {
    console.error("[SkillTree] Failed to parse LLM response:", responseText);
    res.status(502);
    throw new Error("LLM returned invalid JSON. Please try again.");
  }

  // ── Validate basic structure ──
  if (!Array.isArray(nodes) || nodes.length === 0) {
    res.status(502);
    throw new Error("LLM returned an empty or invalid skill tree");
  }

  const validCategories = new Set(["verified", "foundational", "recommended"]);
  const nodeIds = new Set();

  for (const node of nodes) {
    if (!node.id || !node.name || !validCategories.has(node.category)) {
      res.status(502);
      throw new Error(`Invalid node in LLM response: ${JSON.stringify(node)}`);
    }
    if (nodeIds.has(node.id)) {
      res.status(502);
      throw new Error(`Duplicate node id in LLM response: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  // Verify parentId references are valid
  for (const node of nodes) {
    if (node.parentId !== null && !nodeIds.has(node.parentId)) {
      // Auto-fix: set orphan nodes as roots rather than rejecting
      node.parentId = null;
    }
  }

  // ── Persist to user document ──
  user.skillTree = {
    nodes,
    generatedAt: new Date(),
    sourceHash: inputHash,
  };

  await user.save();

  res.status(201).json({
    message: "Skill tree generated successfully",
    skillTree: user.skillTree,
    cached: false,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @desc    Get current user's Skill Tree
// @route   GET /api/skill-tree
// @access  Private
// ─────────────────────────────────────────────────────────────────────────────
const getSkillTree = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("skillTree name githubUsername");

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (!user.skillTree || !user.skillTree.nodes || user.skillTree.nodes.length === 0) {
    return res.status(404).json({
      message: "No skill tree has been generated yet. Use POST /api/skill-tree/generate to create one.",
    });
  }

  res.json({
    skillTree: user.skillTree,
    user: { name: user.name, githubUsername: user.githubUsername },
  });
});

module.exports = { generateSkillTree, getSkillTree };
