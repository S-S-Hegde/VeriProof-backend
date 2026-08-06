const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const API_BASE = 'http://localhost:5000/api';

async function runTest() {
  try {
    console.log("1. Registering user...");
    const regRes = await axios.post(`${API_BASE}/users`, {
      name: "Test Flow",
      email: `testflow_${Date.now()}@example.com`,
      password: "Password123!",
      role: "student",
      origin: "self_registered"
    });
    const token = regRes.data.token;
    console.log("User registered with token:", token.substring(0, 10) + "...");
    
    const headers = { Authorization: `Bearer ${token}` };
    
    console.log("2. Setting GitHub Username and Uploading resume...");
    // Mock setting the github username so analysis runs
    await axios.put(`${API_BASE}/users/profile`, { githubUsername: 'mizudotdev' }, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const form = new FormData();
    form.append('resume', fs.createReadStream('../dummy_resume.txt'), { filename: 'dummy_resume.txt', contentType: 'text/plain' });
    
    const uploadRes = await axios.post(`${API_BASE}/users/profile/resume-file`, form, {
      headers: { ...headers, ...form.getHeaders() }
    });
    console.log("Upload response:", uploadRes.data.message);
    
    console.log("3. Polling for analysis completion...");
    let pipelineStage = "resume_upload";
    let githubStarted = false;
    while (true) {
      const profileRes = await axios.get(`${API_BASE}/users/profile`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      pipelineStage = profileRes.data.pipelineStage;
      
      const resAnalysis = await axios.get(`${API_BASE}/users/profile/resume-analysis`, {
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => ({ data: { status: "Parsing", progress: 10 } }));
      
      if (resAnalysis.data.status === "Analysis Complete") {
        console.log(`Status: ${resAnalysis.data.status} (${resAnalysis.data.progress}%)`);
        
        // Now poll github
        if (!githubStarted) {
           console.log("3b. Polling for GitHub analysis completion...");
           githubStarted = true;
        }
        
        const ghRes = await axios.get(`${API_BASE}/github/status`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        console.log(`GH Status: ${ghRes.data.status} (${ghRes.data.progress}%) - Processed: ${ghRes.data.reposProcessed || 0}/${ghRes.data.totalRepos || 0}`);
        
        if (ghRes.data.status === "complete") {
            break;
        }
        if (ghRes.data.status === "Failed" || ghRes.data.status === "GitHub Analysis Error") {
            throw new Error(`GitHub analysis failed: ${ghRes.data.error || 'Unknown error'}`);
        }
        
        // If github hasn't started and we are waiting, just break if no github analysis is expected
        // But since we provided a URL, it should start.
      } else if (resAnalysis.data.status === "Failed") {
        throw new Error("Resume analysis failed");
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log("4. Verifying dashboard / profile state...");
    const profRes = await axios.get(`${API_BASE}/users/profile`, { headers });
    console.log("Pipeline stage:", profRes.data.pipelineStage);
    console.log("Resume status:", profRes.data.resumeStatus);
    
    console.log("5. Starting Exam...");
    const startRes = await axios.get(`${API_BASE}/exams/start`, { headers });
    console.log(`Exam started with ${startRes.data.length} questions.`);
    
    const answers = startRes.data.map(q => ({
      questionId: q._id,
      answerIndex: 0 // Just guess 0
    }));
    
    console.log("6. Submitting Exam...");
    const submitRes = await axios.post(`${API_BASE}/exams/submit`, { answers }, { headers });
    console.log("Exam Score:", submitRes.data.score);
    console.log("Exam Status:", submitRes.data.status);
    
    console.log("7. Checking Verification Result & Post-Assessment State...");
    const profRes2 = await axios.get(`${API_BASE}/users/profile`, { headers });
    console.log("Final Pipeline stage:", profRes2.data.pipelineStage);
    console.log("hasExamPassed:", profRes2.data.workflowState?.hasExamPassed);

    if (profRes2.data.pipelineStage !== "verification_complete") {
      throw new Error(`Expected pipelineStage 'verification_complete', got '${profRes2.data.pipelineStage}'`);
    }
    if (!profRes2.data.workflowState?.hasExamPassed) {
      throw new Error("Expected workflowState.hasExamPassed to be true");
    }

    const treeRes = await axios.get(`${API_BASE}/skill-tree`, { headers });
    console.log("Skill Tree Verified Count:", treeRes.data.progress?.verifiedCount);
    console.log("Skill Tree Trust Score:", treeRes.data.progress?.trustScore);

    console.log("✅ ALL WORKFLOWS EXECUTED SUCCESSFULLY.");
  } catch (err) {
    console.error("❌ TEST FAILED:", err.response ? err.response.data : err.message);
  }
}

runTest();
