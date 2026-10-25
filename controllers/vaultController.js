const axios = require("axios");
const Project = require("../models/Project");
const User = require("../models/User");

/**
 * Helper to parse GitHub owner and repository name from various URL formats
 */
const parseRepoUrl = (repoUrl) => {
  if (!repoUrl || typeof repoUrl !== "string") return null;
  const cleaned = repoUrl.trim().replace(/\/$/, "");
  const match = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/i, ""),
  };
};

/**
 * Fetch live repository metrics and commit volume from GitHub REST API
 */
const fetchRepoGitHubData = async (owner, repo, token) => {
  const headers = {
    "User-Agent": "VeriProof-Vault-Sync",
    Accept: "application/vnd.github.v3+json",
  };

  const authToken = token || process.env.GITHUB_ACCESS_TOKEN || process.env.GITHUB_TOKEN;
  if (authToken) {
    headers["Authorization"] = `token ${authToken}`;
  }

  try {
    // 1. Fetch Repository Metadata
    const repoRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      timeout: 8000,
    });
    const repoMeta = repoRes.data || {};

    // 2. Fetch Total Commits Count via lightweight Link header pagination (?per_page=1)
    let commitCount = 0;
    let latestCommitDate = null;
    let latestCommitAuthor = "";

    try {
      const commitRes = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`,
        { headers, timeout: 8000 }
      );

      const linkHeader = commitRes.headers["link"];
      if (linkHeader) {
        // Link header format: <...commits?per_page=1&page=42>; rel="last"
        const match = linkHeader.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
        if (match && match[1]) {
          commitCount = parseInt(match[1], 10);
        } else {
          commitCount = Array.isArray(commitRes.data) ? commitRes.data.length : 1;
        }
      } else {
        commitCount = Array.isArray(commitRes.data) ? commitRes.data.length : 1;
      }

      if (commitRes.data && commitRes.data[0]) {
        latestCommitDate =
          commitRes.data[0].commit?.author?.date ||
          commitRes.data[0].commit?.committer?.date ||
          null;
        latestCommitAuthor =
          commitRes.data[0].commit?.author?.name ||
          commitRes.data[0].author?.login ||
          "";
      }
    } catch (commitErr) {
      // If 409 (Git Repository is empty) or 404
      console.warn(`[Vault Sync] Commit fetch notice for ${owner}/${repo}:`, commitErr.message);
    }

    // 3. Fetch Languages Breakdown
    let languages = {};
    try {
      const langRes = await axios.get(`https://api.github.com/repos/${owner}/${repo}/languages`, {
        headers,
        timeout: 5000,
      });
      languages = langRes.data || {};
    } catch (_) {}

    return {
      success: true,
      commitCount: Math.max(commitCount, 1),
      stars: repoMeta.stargazers_count || 0,
      forks: repoMeta.forks_count || 0,
      defaultBranch: repoMeta.default_branch || "main",
      isFork: Boolean(repoMeta.fork),
      latestCommitDate,
      latestCommitAuthor,
      languages,
    };
  } catch (err) {
    console.warn(`[Vault Sync] GitHub query failed for ${owner}/${repo}:`, err.response?.data?.message || err.message);
    return null;
  }
};

/**
 * @desc    Sync candidate's repository vault with live GitHub API data
 * @route   POST /api/vault/sync
 * @access  Private (Candidate)
 */
const syncVault = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    const projects = await Project.find({ user: userId });

    const githubToken = process.env.GITHUB_ACCESS_TOKEN || process.env.GITHUB_TOKEN;

    let syncedCount = 0;

    for (const project of projects) {
      let updated = false;

      // Primary Repository URL
      if (project.repositoryUrl) {
        const parsed = parseRepoUrl(project.repositoryUrl);
        if (parsed) {
          const ghData = await fetchRepoGitHubData(parsed.owner, parsed.repo, githubToken);
          if (ghData) {
            project.githubStats = {
              commitsCount: ghData.commitCount,
              stars: ghData.stars,
              forks: ghData.forks,
              languages: ghData.languages || project.githubStats?.languages || {},
              lastCommitDate: ghData.latestCommitDate
                ? new Date(ghData.latestCommitDate)
                : project.githubStats?.lastCommitDate || new Date(),
              lastSyncedAt: new Date(),
            };

            // Calculate Originality Confidence (100% for non-forks, 75% for forks)
            project.originalityScore = ghData.isFork ? 75 : 100;
            project.isVerified = true;
            if (project.status === "Draft") {
              project.status = "Published";
            }
            if (!project.verificationStatus || project.verificationStatus === "Unverified") {
              project.verificationStatus = "Verified";
            }
            updated = true;
          }
        }
      }

      // Coupled Microservices / Linked Repositories
      if (Array.isArray(project.linkedRepositories) && project.linkedRepositories.length > 0) {
        let coupledExtraCommits = 0;
        for (const lr of project.linkedRepositories) {
          if (lr.repositoryUrl) {
            const parsedLr = parseRepoUrl(lr.repositoryUrl);
            if (parsedLr) {
              const lrGhData = await fetchRepoGitHubData(parsedLr.owner, parsedLr.repo, githubToken);
              if (lrGhData) {
                lr.commitsCount = lrGhData.commitCount;
                lr.isVerified = true;
                coupledExtraCommits += lrGhData.commitCount;
                updated = true;
              }
            }
          }
        }
        if (coupledExtraCommits > 0 && project.githubStats) {
          project.githubStats.commitsCount += coupledExtraCommits;
        }
      }

      if (updated) {
        try {
          await project.save();
          syncedCount++;
        } catch (saveErr) {
          console.warn("[Vault Sync] Project save warning:", saveErr.message);
        }
      }
    }

    // Retrieve fresh projects
    const updatedProjects = await Project.find({ user: userId }).sort({ createdAt: -1 });

    const totalRepositories = updatedProjects.length;
    const totalCommits = updatedProjects.reduce(
      (sum, p) => sum + (p.githubStats?.commitsCount || 0),
      0
    );
    const verifiedProofs = updatedProjects.filter(
      (p) =>
        p.isVerified ||
        p.status === "Verified" ||
        p.verificationStatus === "Verified" ||
        Boolean(p.githubStats?.commitsCount > 0)
    ).length;

    const avgOriginality =
      totalRepositories > 0
        ? Math.round(
            updatedProjects.reduce((sum, p) => sum + (p.originalityScore || 100), 0) /
              totalRepositories
          )
        : 100;

    return res.json({
      success: true,
      message: `Vault successfully synchronized ${syncedCount} repositories with GitHub.`,
      metrics: {
        totalRepositories,
        totalCommits,
        verifiedProofs,
        originalityConfidence: avgOriginality,
        lastSyncedAt: new Date().toISOString(),
      },
      projects: updatedProjects,
    });
  } catch (err) {
    console.error("[Vault Sync Error]:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to synchronize vault with GitHub.",
      error: err.message,
    });
  }
};

/**
 * @desc    Get aggregated Vault metrics for authenticated candidate
 * @route   GET /api/vault/metrics
 * @access  Private (Candidate)
 */
const getVaultMetrics = async (req, res) => {
  try {
    const userId = req.user._id;
    const projects = await Project.find({ user: userId }).sort({ createdAt: -1 });

    const totalRepositories = projects.length;
    const totalCommits = projects.reduce(
      (sum, p) => sum + (p.githubStats?.commitsCount || 0),
      0
    );
    const verifiedProofs = projects.filter(
      (p) =>
        p.isVerified ||
        p.status === "Verified" ||
        p.verificationStatus === "Verified" ||
        Boolean(p.githubStats?.commitsCount > 0)
    ).length;

    const avgOriginality =
      totalRepositories > 0
        ? Math.round(
            projects.reduce((sum, p) => sum + (p.originalityScore || 100), 0) /
              totalRepositories
          )
        : 100;

    // Get latest sync timestamp across projects
    const latestSync = projects.reduce((latest, p) => {
      const syncDate = p.githubStats?.lastSyncedAt;
      if (syncDate && (!latest || new Date(syncDate) > new Date(latest))) {
        return syncDate;
      }
      return latest;
    }, null);

    return res.json({
      success: true,
      metrics: {
        totalRepositories,
        totalCommits,
        verifiedProofs,
        originalityConfidence: avgOriginality,
        lastSyncedAt: latestSync || new Date().toISOString(),
      },
      projects,
    });
  } catch (err) {
    console.error("[Vault Metrics Error]:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch vault metrics.",
      error: err.message,
    });
  }
};

module.exports = {
  syncVault,
  getVaultMetrics,
};
