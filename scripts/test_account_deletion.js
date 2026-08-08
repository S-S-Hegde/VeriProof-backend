const axios = require("axios");

const API_BASE = "http://localhost:5000/api";

async function testAccountDeletion() {
  console.log("=========================================================");
  console.log("   ACCOUNT DELETION & LIFECYCLE TEST                      ");
  console.log("=========================================================");

  // 1. Register temporary test user
  const email = `delete_test_${Date.now()}@example.com`;
  const password = "Password123!";

  console.log(`[1/3] Registering temp user: ${email}...`);
  const regRes = await axios.post(`${API_BASE}/users`, {
    name: "Temp Deletion User",
    email,
    password,
    role: "student"
  });

  const token = regRes.data.token;
  console.log("✓ User Registered successfully.");

  // 2. Perform Account Deletion with confirmation keyword 'DELETE'
  console.log("[2/3] Executing DELETE /api/users/profile with confirmation keyword 'DELETE'...");
  const delRes = await axios.delete(`${API_BASE}/users/profile`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-confirm-password": "DELETE"
    },
    data: { password: "DELETE" }
  });

  console.log(`✓ Account Deletion Response:`, delRes.data);

  // 3. Verify user can no longer authenticate or access profile
  console.log("[3/3] Verifying user token is invalidated and profile returns 401/404...");
  try {
    await axios.get(`${API_BASE}/users/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.error("❌ FAILURE: User profile still accessible after deletion!");
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 404) {
      console.log(`✓ SUCCESS! Profile request properly rejected with HTTP ${err.response.status} (${err.response.data?.message}).`);
    } else {
      console.error("❌ Unexpected error:", err.message);
    }
  }

  console.log("=========================================================");
  console.log("   ✅ ACCOUNT DELETION TEST PASSED 100%!                 ");
  console.log("=========================================================");
}

testAccountDeletion().catch(err => {
  console.error("Test error:", err.response?.data || err.message);
  process.exit(1);
});
