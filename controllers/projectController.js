const Project = require("../models/Project");
const { getRepoDetails } = require("../services/githubService");

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
    const projects = await Project.find({}).populate(
      "user",
      "name githubUsername profileImage",
    );
    res.json(projects);
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

// @desc    Sync project stats with GitHub
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

    // Fetch details
    const stats = await getRepoDetails(project.repositoryUrl);

    project.githubStats = {
      ...project.githubStats,
      lastCommitDate: stats.lastCommitDate,
      languages: stats.languages,
    };

    const updatedProject = await project.save();
    res.json(updatedProject);
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
};
