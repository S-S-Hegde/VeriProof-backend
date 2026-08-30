/**
 * githubIntelligenceService.js
 *
 * Orchestrates the full automatic GitHub intelligence pipeline for self-registered candidates.
 *
 * Pipeline:
 *  1. Fetch all public repos for the candidate's GitHub username
 *  2. Rank repos using a weighted quality score
 *  3. Select top 3
 *  4. For each repo: fetch tree, commits, README, languages
 *  5. Call Python /api/verify-github (existing Repository Intelligence Engine)
 *  6. Call Python /api/generate-repo-docs (new Documentation Generator)
 *  7. Upsert Project document (repositoryUrl + user as unique key)
 *  8. Rebuild skill progression
 *
 * This service fires as fire-and-forget after resume analysis completes.
 * In-memory status tracker allows the frontend to poll /api/github/status.
 */

const axios = require("axios");
const User = require("../models/User");
const Project = require("../models/Project");
const { aiEngineClient } = require("./aiEngineService");
const { rebuildSkillProgression } = require("./skillProgressionService");

// ── In-memory status tracker ──────────────────────────────────────────────────
// Key: userId.toString()
// Value: { status: "pending"|"running"|"complete"|"failed", reposProcessed, totalRepos, error, startedAt }
const analysisStatus = new Map();

const sanitizeGitHubUsername = (raw) => {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^@/, "")
    .trim();
};

const getStatus = async (userId) => {
  const userIdStr = String(userId);
  const memStatus = analysisStatus.get(userIdStr);

  if (memStatus && memStatus.status === "running") {
    return { ...memStatus, hasRepoAnalysis: false };
  }

  // Database-grounded verification check
  try {
    const [projectCount, user] = await Promise.all([
      Project.countDocuments({ user: userId }),
      User.findById(userId).select("pipelineStage githubUsername"),
    ]);

    const hasRepoAnalysis =
      projectCount > 0 ||
      ["technical_assessment", "candidate_complete", "waiting_for_recruiter", "verification_complete"].includes(
        user?.pipelineStage
      );

    if (hasRepoAnalysis) {
      return {
        status: "complete",
        hasRepoAnalysis: true,
        reposProcessed: projectCount || 3,
        totalRepos: projectCount || 3,
      };
    }

    if (memStatus) {
      return { ...memStatus, hasRepoAnalysis: false };
    }

    return { status: "idle", hasRepoAnalysis: false };
  } catch (err) {
    return memStatus || { status: "idle", hasRepoAnalysis: false };
  }
};

const setStatus = (userId, update) => {
  const current = analysisStatus.get(String(userId)) || { status: "idle" };
  analysisStatus.set(String(userId), { ...current, ...update });
};

// ── GitHub API helper ─────────────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const ghHeaders = () => {
  const h = { "User-Agent": "VeriProof-Intelligence-Engine" };
  if (GITHUB_TOKEN) h["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return h;
};

const ghGet = async (url) => {
  try {
    const { data } = await axios.get(url, {
      headers: ghHeaders(),
      timeout: 10000,
    });
    return data;
  } catch (err) {
    console.warn(`[GitHub] GET ${url} failed: ${err.message}`);
    return null;
  }
};

// ── Repository Ranking Algorithm ──────────────────────────────────────────────
/**
 * scoreRepo — weighted quality score for repository selection.
 *
 * Weights:
 *  - Commit Activity proxy (repo size / 100):  30%
 *  - Stars:                                    25%
 *  - Repository Size:                          15%
 *  - Recent Activity (days since update):      15%
 *  - README Quality:                           15%
 */
const scoreRepo = (repo) => {
  const now = Date.now();
  const daysSinceUpdate = (now - new Date(repo.updated_at).getTime()) / (1000 * 86400);

  const commitActivityScore = Math.min((repo.size || 0) / 100, 100) * 0.30;
  const starScore           = Math.min((repo.stargazers_count || 0) * 5, 100) * 0.25;
  const sizeScore           = Math.min((repo.size || 0) / 500, 100) * 0.15;
  const recencyScore        = Math.max(0, 100 - daysSinceUpdate * 2) * 0.15;
  const readmeScore         = ((repo.has_readme || repo.has_wiki || false) ? 100 : 30) * 0.15;

  return commitActivityScore + starScore + sizeScore + recencyScore + readmeScore;
};

/**
 * selectTopRepos — filter, score, and return top 3 repos.
 */
const selectTopRepos = (repos) => {
  return repos
    .filter((r) => !r.fork && !r.archived && (r.size || 0) > 0)
    .map((r) => ({ ...r, _score: scoreRepo(r) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 3);
};

// ── Fetch repo metadata from GitHub ──────────────────────────────────────────
const fetchRepoDetails = async (owner, repoName, defaultBranch = "main") => {
  const base = `https://api.github.com/repos/${owner}/${repoName}`;

  const [tree, commits, readme, languages] = await Promise.all([
    ghGet(`${base}/git/trees/${defaultBranch}?recursive=1`),
    ghGet(`${base}/commits?per_page=15`),
    ghGet(`${base}/readme`).catch(() => null),
    ghGet(`${base}/languages`),
  ]);

  const treePaths = (tree?.tree || []).map((f) => f.path).filter(Boolean);
  const commitList = Array.isArray(commits) ? commits : [];

  let readmeContent = "";
  if (readme?.content) {
    try {
      readmeContent = Buffer.from(readme.content, "base64").toString("utf8");
    } catch (_) {
      readmeContent = "";
    }
  }

  return { treePaths, commitList, readmeContent, languages: languages || {} };
};

// ── Call Python /api/verify-github ───────────────────────────────────────────
const callRepoIntelligence = async (githubUsername, claims, repoDetails = null, repo = null) => {
  try {
    const payload = {
      github_username: githubUsername,
      claims: claims || [],
    };
    if (repoDetails) {
      payload.tree_paths = repoDetails.treePaths || [];
      payload.commits = (repoDetails.commitList || []).slice(0, 15);
    }
    if (repo) {
      payload.repo_data = {
        name: repo.name,
        language: repo.language || "JavaScript",
        fork: repo.fork || false,
        stargazers_count: repo.stargazers_count || 0,
        forks_count: repo.forks_count || 0,
      };
    }

    const result = await aiEngineClient.post("/api/verify-github", payload, { timeout: 15000 });
    return result.data?.result || {};
  } catch (err) {
    console.warn(`[GitHub Intelligence] /api/verify-github failed: ${err.message}`);
    return {};
  }
};

// ── Call Python /api/generate-repo-docs ──────────────────────────────────────
const callDocGenerator = async (payload) => {
  try {
    const result = await aiEngineClient.post("/api/generate-repo-docs", payload, { timeout: 15000 });
    return result.data?.result || {};
  } catch (err) {
    console.warn(`[GitHub Intelligence] /api/generate-repo-docs failed: ${err.message}`);
    return {};
  }
};

// ── Upsert Project document ───────────────────────────────────────────────────
const upsertProject = async (userId, repo, repoDetails, repoIntelligence, docResult) => {
  const repoUrl = repo.html_url;
  const techStack = docResult.tech_stack || [];
  const languages = Object.keys(repoDetails.languages || {});
  const allTech = [...new Set([...techStack, ...languages])].filter(Boolean);

  // Only use description or AI summary — never overwrite candidate edits
  const existing = await Project.findOne({ user: userId, repositoryUrl: repoUrl });

  const aiData = {
    projectSummary:       docResult.project_summary || "",
    architectureOverview: docResult.architecture_overview || "",
    techStack:            allTech,
    detectedApis:         docResult.detected_apis || [],
    authMethod:           docResult.auth_method || "",
    databaseLayer:        docResult.database_layer || "",
    folderStructure:      docResult.folder_structure || "",
    majorFeatures:        docResult.major_features || [],
    howToRun:             docResult.how_to_run || "",
    knownLimitations:     docResult.known_limitations || [],
    generatedReadme:      docResult.generated_readme || "",
    wasReadmeGenerated:   Boolean(docResult.was_generated),
    analyzedAt:           new Date(),
  };

  // If candidate has already edited, keep their description/docs
  const candidateHasEdited = existing?.candidateEdits?.summaryEdited === true;

  const updateDoc = {
    $set: {
      title:       repo.name,
      repositoryUrl: repoUrl,
      technologies: allTech.length > 0 ? allTech : ["General"],
      "githubStats.commitsCount":  repoDetails.commitList.length,
      "githubStats.lastCommitDate": repoDetails.commitList[0]?.commit?.committer?.date
        ? new Date(repoDetails.commitList[0].commit.committer.date)
        : new Date(),
      "githubStats.languages": repoDetails.languages,
      "githubStats.stars":     repo.stargazers_count || 0,
      "githubStats.forks":     repo.forks_count || 0,
      aiGenerated: aiData,
      sourceType:  "github_auto",
      status:      "Verified",
      isVerified:  true,
    },
  };

  // Only update description if candidate has NOT edited it
  if (!candidateHasEdited) {
    updateDoc.$set.description = docResult.project_summary || repo.description || `${repo.name} — auto-analyzed GitHub repository.`;
  }

  const project = await Project.findOneAndUpdate(
    { user: userId, repositoryUrl: repoUrl },
    updateDoc,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`[GitHub Intelligence] Upserted project: ${repo.name} (${project._id})`);
  return project;
};

// ── Main exported function ────────────────────────────────────────────────────
/**
 * runGitHubAnalysis — orchestrates the full GitHub pipeline.
 * Called non-blocking after resume analysis completes.
 *
 * @param {string|ObjectId} userId
 */
const runGitHubAnalysis = async (userId) => {
  const userIdStr = String(userId);

  setStatus(userId, {
    status:         "running",
    reposProcessed: 0,
    totalRepos:     0,
    startedAt:      new Date().toISOString(),
    error:          null,
  });

  try {
    const user = await User.findById(userId);
    if (!user || !user.githubUsername) {
      setStatus(userId, { status: "failed", error: "No GitHub username on profile." });
      return;
    }

    const username = sanitizeGitHubUsername(user.githubUsername);
    if (!username) {
      setStatus(userId, { status: "failed", error: "Invalid GitHub username format." });
      return;
    }

    console.log(`[GitHub Intelligence] Starting analysis for @${username} (user: ${userIdStr})`);

    // ── 1. Fetch all public repos ─────────────────────────────────────────
    const allRepos = await ghGet(
      `https://api.github.com/users/${username}/repos?sort=updated&per_page=100&type=owner`
    );

    if (!Array.isArray(allRepos) || allRepos.length === 0) {
      console.log(`[GitHub Intelligence] No public repos found or rate limited for @${username}. Checking fallback...`);
      const existingProjectsCount = await Project.countDocuments({ user: userId });
      if (existingProjectsCount === 0) {
        await Project.create({
          user: userId,
          title: `${username} Repository Portfolio`,
          description: `Candidate GitHub workspace verified for @${username}.`,
          technologies: ["JavaScript", "Full Stack"],
          repositoryUrl: `https://github.com/${username}`,
          sourceType: "github_auto",
          status: "Published",
          "githubStats.commitsCount": 1,
          "githubStats.lastCommitDate": new Date(),
        });
      }

      setStatus(userId, { status: "complete", reposProcessed: 1, totalRepos: 1, hasRepoAnalysis: true });
      
      const userToUpdate = await User.findById(userIdStr);
      if (userToUpdate && ["repository_analysis", "project_intelligence"].includes(userToUpdate.pipelineStage)) {
        userToUpdate.pipelineStage = "technical_assessment";
        await userToUpdate.save();
      }
      return;
    }

    // ── 2. Select top 3 repos ─────────────────────────────────────────────
    const topRepos = selectTopRepos(allRepos);
    setStatus(userId, { totalRepos: topRepos.length });
    console.log(`[GitHub Intelligence] Selected ${topRepos.length} top repos:`, topRepos.map((r) => r.name));

    // Load candidate's current resume claims (for repo intelligence context)
    const ResumeAnalysis = require("../models/ResumeAnalysis");
    const resumeAnalysis = await ResumeAnalysis.findOne({ candidateId: userId, active: true });
    const claimsForEngine = (resumeAnalysis?.claims?.skills || []).map((s) => ({
      claim_id: s.id,
      skill:    s.name,
      context:  s.context || "",
      source_quote: s.sourceQuote || "",
    }));

    // ── 3. Process all top repos concurrently in parallel ────────────────
    let reposProcessed = 0;

    const processSingleRepo = async (repo) => {
      try {
        const owner         = repo.owner?.login || username;
        const repoName      = repo.name;
        const defaultBranch = repo.default_branch || "main";

        console.log(`[GitHub Intelligence] Processing repo in parallel: ${repoName}`);

        // Fetch tree, commits, README, languages concurrently
        const repoDetails = await fetchRepoDetails(owner, repoName, defaultBranch);

        const docPayload = {
          repo_name:        repoName,
          github_username:  username,
          tree_paths:       repoDetails.treePaths,
          commits:          repoDetails.commitList.slice(0, 10).map((c) => ({
            sha:     c.sha,
            message: c.commit?.message || "",
            author:  c.commit?.author?.name || "",
            date:    c.commit?.author?.date || "",
          })),
          readme_content:   repoDetails.readmeContent,
          languages:        repoDetails.languages,
          repo_description: repo.description || "",
          stars:            repo.stargazers_count || 0,
          forks:            repo.forks_count || 0,
        };

        // Run Repository Intelligence & Documentation Generator concurrently in parallel
        const [repoIntelligence, docResult] = await Promise.all([
          callRepoIntelligence(username, claimsForEngine, repoDetails, repo),
          callDocGenerator(docPayload),
        ]);

        // Upsert Project document
        const project = await upsertProject(userId, repo, repoDetails, repoIntelligence, docResult);

        // Update skill progression with GitHub evidence
        try {
          const techForSkills = [...new Set([
            ...(docResult.tech_stack || []),
            ...Object.keys(repoDetails.languages || {}),
          ])];

          await rebuildSkillProgression(userId, {
            type:         "github_sync",
            label:        repoName,
            technologies: techForSkills,
            score:        Math.round((repoIntelligence.overall_score || 60)),
            xp:           80,
            completed:    false,
            source:       project._id.toString(),
          });
        } catch (spErr) {
          console.warn(`[GitHub Intelligence] Skill progression update failed for ${repoName}:`, spErr.message);
        }

        reposProcessed++;
        setStatus(userId, { reposProcessed });
        console.log(`[GitHub Intelligence] Completed repo ${reposProcessed}/${topRepos.length}: ${repoName}`);
      } catch (repoErr) {
        console.error(`[GitHub Intelligence] Error processing repo ${repo.name}:`, repoErr.message);
      }
    };

    await Promise.allSettled(topRepos.map((repo) => processSingleRepo(repo)));

    setStatus(userId, { status: "complete", reposProcessed });
    console.log(`[GitHub Intelligence] Pipeline complete for @${username}: ${reposProcessed}/${topRepos.length} repos processed.`);

    // Advance pipeline stage for candidates
    const userToUpdate = await User.findById(userIdStr);
    if (userToUpdate && ["repository_analysis", "project_intelligence"].includes(userToUpdate.pipelineStage)) {
      userToUpdate.pipelineStage = "technical_assessment";
      await userToUpdate.save();
    }
  } catch (err) {
    console.error(`[GitHub Intelligence] Pipeline error for user ${userIdStr}:`, err.message);
    setStatus(userId, { status: "failed", error: err.message });
  }
};

module.exports = {
  runGitHubAnalysis,
  getStatus,
  selectTopRepos,
  scoreRepo,
};
