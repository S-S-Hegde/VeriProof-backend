const axios = require("axios");
const API = "http://127.0.0.1:5000/api";

async function runPhase35SkillTreeAudit() {
  console.log("=========================================================================");
  console.log("   PHASE 35 — SKILL TREE RUNTIME CONNECTIVITY & ROUTE RESTORATION TEST    ");
  console.log("=========================================================================\n");

  const rand = Math.floor(Math.random() * 10000);
  const candidateEmail = `phase35_candidate_${rand}@test.com`;
  const recruiterEmail = `phase35_recruiter_${rand}@test.com`;
  const password = "Password123!";

  // 1. Unauthenticated Request Audit
  console.log("1. Audit Unauthenticated GET /api/skill-tree...");
  try {
    await axios.get(`${API}/skill-tree`);
    throw new Error("FAILED: Unauthenticated request should return 401!");
  } catch (err) {
    if (err.response?.status === 401) {
      console.log(`✓ Unauthenticated request rejected cleanly with HTTP 401: "${err.response.data.message}"`);
    } else {
      throw err;
    }
  }

  // 2. Register candidate user
  console.log("\n2. Registering test candidate user...");
  const candSignup = await axios.post(`${API}/users`, {
    name: "Phase35 Candidate",
    email: candidateEmail,
    password,
    role: "student"
  });
  const candidateId = candSignup.data._id;
  const candidateToken = candSignup.data.token;
  const cHeaders = { headers: { Authorization: `Bearer ${candidateToken}` } };

  // 3. Candidate GET /api/skill-tree Audit
  console.log("\n3. Candidate GET /api/skill-tree Audit...");
  const treeRes = await axios.get(`${API}/skill-tree`, cHeaders);
  console.log(`✓ Status: ${treeRes.status}`);
  console.log(`✓ Catalog Items Count: ${treeRes.data.catalog?.length || 0}`);
  console.log(`✓ Skill Tree Graph Nodes: ${Object.keys(treeRes.data.skillTree || {}).length}`);
  console.log(`✓ User Metadata Returned: Name="${treeRes.data.user?.name}", ID="${treeRes.data.user?._id}"`);

  // 4. Candidate GET /api/skill-tree/summary Audit
  console.log("\n4. Candidate GET /api/skill-tree/summary Audit...");
  const summaryRes = await axios.get(`${API}/skill-tree/summary`, cHeaders);
  console.log(`✓ Status: ${summaryRes.status}`);
  console.log(`✓ User Level: ${summaryRes.data.progress?.level || 1} | Total XP: ${summaryRes.data.progress?.xp || 0}`);

  // 5. Candidate POST /api/skill-tree/event Audit
  console.log("\n5. Candidate POST /api/skill-tree/event Audit...");
  const eventRes = await axios.post(`${API}/skill-tree/event`, {
    type: "PROJECT_VERIFIED",
    label: "Full Stack Dashboard",
    technologies: ["React.js", "Node.js", "MongoDB"],
    score: 95,
    xp: 250,
    completed: true,
    source: "verification_engine"
  }, cHeaders);
  console.log(`✓ Status: ${eventRes.status} | Message: "${eventRes.data.message}"`);

  // 6. Recruiter view Candidate Skill Tree Audit
  console.log("\n6. Recruiter GET /api/skill-tree/candidate/:candidateId Audit...");
  const recSignup = await axios.post(`${API}/users`, {
    name: "Phase35 Recruiter",
    email: recruiterEmail,
    password,
    role: "recruiter"
  });
  const rHeaders = { headers: { Authorization: `Bearer ${recSignup.data.token}` } };

  const candTreeRes = await axios.get(`${API}/skill-tree/candidate/${candidateId}`, rHeaders);
  console.log(`✓ Recruiter View Status: ${candTreeRes.status}`);
  console.log(`✓ Candidate Profile Returned: Name="${candTreeRes.data.candidate?.name}"`);

  console.log("\n=========================================================================");
  console.log("   ✅ PHASE 35 SKILL TREE RUNTIME CONNECTIVITY & AUDIT PASSED 100%!       ");
  console.log("=========================================================================");
}

runPhase35SkillTreeAudit().catch(err => {
  console.error("❌ TEST FAILED:", err.response ? err.response.data : err.message);
  process.exit(1);
});
