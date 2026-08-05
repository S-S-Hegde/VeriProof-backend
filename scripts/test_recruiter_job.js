const axios = require('axios');
const API_BASE = 'http://localhost:5000/api';

async function testRecruiterJob() {
  try {
    const timestamp = Date.now();
    // 1. Register Recruiter
    console.log("1. Registering recruiter...");
    const regRes = await axios.post(`${API_BASE}/users`, {
      name: `Recruiter Test ${timestamp}`,
      email: `recruiter_${timestamp}@test.com`,
      password: 'Password123!',
      role: 'recruiter'
    });
    const token = regRes.data.token;
    const headers = { Authorization: `Bearer ${token}` };

    // 2. Create Job with raw targetSkills strings
    console.log("2. Creating job role with string targetSkills...");
    const job1 = await axios.post(`${API_BASE}/verify/job`, {
      title: "Frontend Engineer",
      description: "React and Node.js position",
      targetSkills: ["React", "Node.js", "MongoDB"]
    }, { headers });
    console.log("Job 1 Created successfully! ID:", job1.data._id, "Skills:", job1.data.targetSkills);

    // 3. Create Job with full claim objects in targetSkills (simulating frontend passing claims)
    console.log("3. Creating job role with full claim objects...");
    const job2 = await axios.post(`${API_BASE}/verify/job`, {
      title: "Backend Engineer",
      description: "Python and Express position",
      targetSkills: [
        { claim_id: "c1", skill: "Python", context: "5 years experience", source_quote: "Python dev" },
        { claim_id: "c2", skill: "Express", context: "Built REST APIs", source_quote: "Express APIs" }
      ]
    }, { headers });
    console.log("Job 2 Created successfully! ID:", job2.data._id, "Skills:", job2.data.targetSkills);

    console.log("✅ RECRUITER JOB CREATION TEST PASSED PERFECTLY!");
  } catch (err) {
    console.error("❌ TEST FAILED:", err.response?.data || err.message);
    process.exit(1);
  }
}

testRecruiterJob();
