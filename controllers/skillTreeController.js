const asyncHandler = require("express-async-handler");
const User = require("../models/User");
const { skillCatalog } = require("../data/skillCatalog");
const { rebuildSkillProgression } = require("../services/skillProgressionService");

const publicUserFields = "name githubUsername profileImage bio location college branch skills role profileVisibility skillProgress skillTree certificates resumeStatus";

const getSkillTree = asyncHandler(async (req, res) => {
  const graph = await rebuildSkillProgression(req.user._id);
  const user = await User.findById(req.user._id).select("name githubUsername profileImage skillProgress");

  res.json({
    catalog: skillCatalog,
    skillTree: graph,
    progress: user.skillProgress,
    user: {
      _id: user._id,
      name: user.name,
      githubUsername: user.githubUsername,
      profileImage: user.profileImage,
    },
  });
});

const getCandidateSkillTree = asyncHandler(async (req, res) => {
  const candidate = await User.findById(req.params.candidateId).select(publicUserFields);

  if (!candidate || candidate.role === "recruiter") {
    res.status(404);
    throw new Error("Candidate not found");
  }

  const isOwner = req.user?._id?.toString() === candidate._id.toString();
  const canRecruiterView = req.user?.role === "recruiter" && candidate.profileVisibility !== "private";

  if (!isOwner && !canRecruiterView && candidate.profileVisibility !== "public") {
    res.status(403);
    throw new Error("This candidate profile is not available for skill tree review");
  }

  const graph = await rebuildSkillProgression(candidate._id);
  const refreshedCandidate = await User.findById(candidate._id).select(publicUserFields);

  res.json({
    catalog: skillCatalog,
    skillTree: graph,
    progress: refreshedCandidate.skillProgress,
    candidate: {
      _id: candidate._id,
      name: candidate.name,
      githubUsername: candidate.githubUsername,
      profileImage: candidate.profileImage,
      bio: candidate.bio,
      location: candidate.location,
      college: candidate.college,
      branch: candidate.branch,
      skills: candidate.skills,
      certificates: candidate.certificates,
      resumeStatus: candidate.resumeStatus,
    },
  });
});

const recordSkillEvent = asyncHandler(async (req, res) => {
  const { type, label, technologies, skillIds, score, xp, completed, source } = req.body;
  const graph = await rebuildSkillProgression(req.user._id, {
    type,
    label,
    technologies,
    skillIds,
    score,
    xp,
    completed,
    source,
  });

  const user = await User.findById(req.user._id).select("skillProgress");

  res.status(201).json({
    message: "Skill progression updated",
    skillTree: graph,
    progress: user.skillProgress,
  });
});

const getSkillSummary = asyncHandler(async (req, res) => {
  await rebuildSkillProgression(req.user._id);
  const user = await User.findById(req.user._id).select("skillProgress name githubUsername");

  res.json({
    progress: user.skillProgress,
    user: {
      _id: user._id,
      name: user.name,
      githubUsername: user.githubUsername,
    },
  });
});

module.exports = {
  getSkillTree,
  getCandidateSkillTree,
  recordSkillEvent,
  getSkillSummary,
};
