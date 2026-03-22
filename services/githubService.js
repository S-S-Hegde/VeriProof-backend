const axios = require("axios");

const getRepoDetails = async (repoUrl) => {
  // Extract owner and repo from URL (e.g., https://github.com/owner/repo)
  const repoPath = repoUrl.split("github.com/")[1];

  if (!repoPath) {
    throw new Error("Invalid GitHub URL");
  }

  const config = {
    headers: {
      Authorization: process.env.GITHUB_TOKEN
        ? `token ${process.env.GITHUB_TOKEN}`
        : undefined,
    },
  };

  try {
    // Fetch repo details
    const repoRes = await axios.get(
      `https://api.github.com/repos/${repoPath}`,
      config,
    );

    // Fetch languages
    const langRes = await axios.get(
      `https://api.github.com/repos/${repoPath}/languages`,
      config,
    );

    // Fetch commits info
    const commitsRes = await axios.get(
      `https://api.github.com/repos/${repoPath}/commits?per_page=1`,
      config,
    );

    // Total commits trick (reading Link header) or just count basic commits
    // For simplicity, we just use stargazers, forks, languages, last update
    return {
      lastCommitDate:
        commitsRes.data[0]?.commit?.committer?.date || repoRes.data.updated_at,
      languages: langRes.data,
      stargazers_count: repoRes.data.stargazers_count,
    };
  } catch (error) {
    console.error("Error fetching GitHub data", error);
    throw new Error("Could not fetch GitHub repository details");
  }
};

module.exports = { getRepoDetails };
