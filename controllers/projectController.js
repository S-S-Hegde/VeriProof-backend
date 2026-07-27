const axios = require("axios"); // <-- New import for proxying to Python
const Project = require("../models/Project");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const {
  rebuildSkillProgression,
} = require("../services/skillProgressionService");

const PYTHON_API_BASE = "http://127.0.0.1:8000/api";

// @desc    Create a project
// @route   POST /api/projects
// @access  Private (Student)
const createProject = async (req, res) => {
  const { title, description, technologies, repositoryUrl, liveUrl, images } =
    req.body;

  try {
    const project = new Project({
      user: req.user._id,
      title,
      description,
      technologies,
      repositoryUrl,
      liveUrl,
      images,
    });

    const createdProject = await project.save();
    await rebuildSkillProgression(req.user._id, {
      type: "project",
      label: createdProject.title,
      technologies: createdProject.technologies,
      score: 55,
      xp: 70,
      source: createdProject._id.toString(),
    });
    res.status(201).json(createdProject);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all projects (public or for recruiters)
// @route   GET /api/projects
// @access  Public
const getProjects = async (req, res) => {
  try {
    const {
      search = "",
      tech = "",
      verified = "",
      sort = "latest",
      page = 1,
      limit = 24,
    } = req.query;

    const filters = {};

    if (verified === "true") {
      filters.isVerified = true;
    }

    if (tech) {
      filters.technologies = { $in: [tech] };
    }

    if (search) {
      const regex = new RegExp(search, "i");
      filters.$or = [
        { title: regex },
        { description: regex },
        { technologies: regex },
      ];
    }

    const sortMap = {
      latest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      verified: { isVerified: -1, createdAt: -1 },
      title: { title: 1 },
    };

    const safeLimit = Math.min(Number(limit) || 24, 50);
    const safePage = Math.max(Number(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const [projects, total] = await Promise.all([
      Project.find(filters)
        .sort(sortMap[sort] || sortMap.latest)
        .skip(skip)
        .limit(safeLimit)
        .populate(
          "user",
          "name githubUsername profileImage role skillProgress",
        ),
      Project.countDocuments(filters),
    ]);

    const technologies = await Project.distinct("technologies");

    res.json({
      projects,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
      filters: {
        technologies: technologies
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b)),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged in user's projects
// @route   GET /api/projects/myprojects
// @access  Private
const getMyProjects = async (req, res) => {
  try {
    const projects = await Project.find({ user: req.user._id });
    res.json(projects);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get project by ID
// @route   GET /api/projects/:id
// @access  Public
const getProjectById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id).populate(
      "user",
      "name githubUsername",
    );

    if (project) {
      res.json(project);
    } else {
      res.status(404).json({ message: "Project not found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Sync project stats with GitHub (Proxied to Python Engine)
// @route   PUT /api/projects/:id/sync
// @access  Private
const syncProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Verify ownership
    if (project.user.toString() !== req.user._id.toString()) {
      return res
        .status(401)
        .json({ message: "Not authorized to sync this project" });
    }

    if (
      !project.repositoryUrl ||
      !project.repositoryUrl.includes("github.com")
    ) {
      return res
        .status(400)
        .json({ message: "Valid GitHub repository URL is required" });
    }

    // Extract the GitHub username from the repository URL
    const repoPathParts = project.repositoryUrl
      .split("github.com/")[1]
      .split("/");
    const githubUsername = repoPathParts[0];

    // Retrieve the user's latest parsed claims to send to Python
    const analysis = await ResumeAnalysis.findOne({
      candidateId: req.user._id,
      active: true,
      status: "Analysis Complete",
    });
    const userClaims =
      analysis && analysis.claims ? analysis.claims.skills : [];

    // --- PROXY TO PYTHON MODULE 2 (GitHub Verification) ---
    let githubScore = 0;
    try {
      const pythonRes = await axios.post(`${PYTHON_API_BASE}/verify-github`, {
        github_username: githubUsername,
        claims: userClaims || [],
      });
      githubScore = pythonRes.data.result.overall_score || 0;

      // We no longer receive raw language bytes from Python in this payload format,
      // so we set a default timestamp to show sync completion
      project.githubStats = {
        ...project.githubStats,
        lastCommitDate: new Date(),
      };
    } catch (error) {
      console.error(
        "[Python Proxy] GitHub Verification Failed:",
        error.message,
      );
      return res
        .status(502)
        .json({
          message: "Failed to communicate with AI verification engine.",
        });
    }

    const updatedProject = await project.save();

    // Update the skill tree using the dynamic Python score
    await rebuildSkillProgression(req.user._id, {
      type: "github_sync",
      label: updatedProject.title,
      technologies: updatedProject.technologies || [],
      score:
        githubScore > 0 ? githubScore : updatedProject.isVerified ? 92 : 64,
      xp: 90,
      completed: Boolean(updatedProject.isVerified),
      source: updatedProject._id.toString(),
    });

    res.json(updatedProject);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get analytics data for logged-in user
// @route   GET /api/projects/analytics
// @access  Private
const getMyAnalytics = async (req, res) => {
  try {
    const projects = await Project.find({ user: req.user._id });

    // 1. Skill frequency from project technologies
    const skillTally = {};
    projects.forEach((p) => {
      (p.technologies || []).forEach((tech) => {
        skillTally[tech] = (skillTally[tech] || 0) + 1;
      });
    });
    const skillData = Object.entries(skillTally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, value]) => ({ label, value }));

    // 2. Project status distribution
    const statusTally = { Published: 0, Verified: 0, Pending: 0, Draft: 0 };
    projects.forEach((p) => {
      const s = p.isVerified ? "Verified" : p.status || "Published";
      statusTally[s] = (statusTally[s] || 0) + 1;
    });
    const statusData = Object.entries(statusTally)
      .filter(([, v]) => v > 0)
      .map(([label, value]) => ({ label, value }));

    // 3. Rankings: aggregate across all projects (take latest non-empty)
    const rankings = {
      hackerrank: "",
      leetcode: "",
      codeforces: "",
      codechef: "",
      github: "",
      other: "",
    };
    [...projects].reverse().forEach((p) => {
      if (p.rankings) {
        Object.keys(rankings).forEach((k) => {
          if (!rankings[k] && p.rankings[k]) rankings[k] = p.rankings[k];
        });
      }
    });

    // 4. CGPA (latest non-empty across projects or from user)
    const cgpaEntry = projects.find((p) => p.cgpa)?.cgpa || "";

    // 5. Timeline: project creation dates
    const timeline = projects
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((p) => ({
        _id: p._id,
        title: p.title,
        isVerified: p.isVerified,
        status: p.status,
        createdAt: p.createdAt,
        technologies: p.technologies,
      }));

    // 6. GitHub stars summary from githubStats languages
    const allLanguages = {};
    projects.forEach((p) => {
      if (p.githubStats?.languages) {
        Object.entries(p.githubStats.languages).forEach(([lang, bytes]) => {
          allLanguages[lang] = (allLanguages[lang] || 0) + bytes;
        });
      }
    });
    const languageData = Object.entries(allLanguages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, bytes]) => ({ label, bytes }));

    res.json({
      totalProjects: projects.length,
      verifiedCount: projects.filter((p) => p.isVerified).length,
      skillData,
      statusData,
      rankings,
      cgpa: cgpaEntry,
      timeline,
      languageData,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createProject,
  getProjects,
  getMyProjects,
  getProjectById,
  syncProject,
  getMyAnalytics,
};
