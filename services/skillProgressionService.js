const User = require("../models/User");
const Project = require("../models/Project");
const VerificationResult = require("../models/VerificationResult");
const { skillCatalog, flatSkillCatalog } = require("../data/skillCatalog");

const SKILL_MAP = new Map(flatSkillCatalog.map((skill) => [skill.id, skill]));
const PASSING_SCORE = 70;
const MAX_LEVEL = 12;

const normalize = (value = "") => String(value).trim().toLowerCase();

const levelFromXp = (xp = 0) => Math.min(MAX_LEVEL, Math.floor(Math.sqrt(Math.max(xp, 0) / 125)) + 1);

const getSkillIdsFromText = (values = []) => {
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  const matched = new Set();

  flatSkillCatalog.forEach((skill) => {
    if (skill.triggers.some((trigger) => haystack.includes(normalize(trigger)))) {
      matched.add(skill.id);
    }
  });

  return [...matched];
};

const createBaseSkillState = () => {
  const state = new Map();

  flatSkillCatalog.forEach((skill) => {
    state.set(skill.id, {
      id: skill.id,
      status: "locked",
      progress: 0,
      verificationScore: 0,
      xp: 0,
      level: skill.level,
      evidence: [],
      unlockedAt: undefined,
      completedAt: undefined,
    });
  });

  return state;
};

const addEvidence = (entry, evidence) => {
  const key = `${evidence.type}:${evidence.source}:${evidence.score}:${evidence.label}`;
  if (!entry.evidence.some((item) => `${item.type}:${item.source}:${item.score}:${item.label}` === key)) {
    entry.evidence.push({ ...evidence, createdAt: evidence.createdAt || new Date() });
  }
};

const bumpSkill = (state, skillId, { score, xp, type, source, label, completed = false }) => {
  const skill = SKILL_MAP.get(skillId);
  if (!skill) return;

  const entry = state.get(skillId);
  entry.progress = Math.max(entry.progress, Math.min(100, score));
  entry.verificationScore = Math.max(entry.verificationScore, Math.min(100, score));
  entry.xp = Math.max(entry.xp, 0) + xp;
  entry.level = Math.max(entry.level, levelFromXp(entry.xp));
  entry.status = completed || score >= 85 ? "verified" : "in_progress";
  entry.unlockedAt = entry.unlockedAt || new Date();
  if (entry.status === "verified") entry.completedAt = entry.completedAt || new Date();
  addEvidence(entry, { type, source, label, score });
};

const prerequisitesSatisfied = (state, skill) =>
  skill.prerequisites.every((id) => {
    if (SKILL_MAP.has(id)) {
      return ["unlocked", "in_progress", "verified"].includes(state.get(id)?.status);
    }
    return flatSkillCatalog
      .filter((catalogSkill) => catalogSkill.categoryKey === id)
      .some((catalogSkill) => ["unlocked", "in_progress", "verified"].includes(state.get(catalogSkill.id)?.status));
  });

const resolveUnlocks = (state) => {
  let changed = true;

  while (changed) {
    changed = false;
    flatSkillCatalog.forEach((skill) => {
      const entry = state.get(skill.id);
      if (entry.status !== "locked") return;
      if (!prerequisitesSatisfied(state, skill)) return;

      entry.status = "unlocked";
      entry.progress = Math.max(entry.progress, 12);
      entry.unlockedAt = entry.unlockedAt || new Date();
      changed = true;
    });
  }
};

const deriveAchievements = (state, meta) => {
  const skills = [...state.values()];
  const verifiedCount = skills.filter((skill) => skill.status === "verified").length;
  const unlockedCount = skills.filter((skill) => skill.status !== "locked").length;
  const achievements = [];

  const push = (id, title, description, icon, unlocked) => {
    achievements.push({ id, title, description, icon, unlocked, unlockedAt: unlocked ? new Date() : undefined });
  };

  push("first-proof", "First Proof", "Verified the first skill signal.", "ShieldCheck", verifiedCount >= 1);
  push("frontend-pathfinder", "Frontend Pathfinder", "Unlocked React and its prerequisites.", "Monitor", ["javascript", "html-css", "react"].every((id) => state.get(id)?.status !== "locked"));
  push("api-builder", "API Builder", "Verified backend API capability.", "Server", ["nodejs", "express", "rest-api"].some((id) => state.get(id)?.status === "verified"));
  push("mern-architect", "MERN Architect", "Unlocked the complete MERN stack node.", "Network", state.get("mern-stack")?.status !== "locked");
  push("trusted-candidate", "Trusted Candidate", "Reached a trust score above 80.", "BadgeCheck", meta.trustScore >= 80);
  push("streak-signal", "Momentum Streak", "Maintained a proof activity streak.", "Flame", meta.streakDays >= 3);

  return achievements;
};

const buildGraph = (state, meta) => {
  const categories = skillCatalog.map((category, index) => ({
    id: category.key,
    name: category.name,
    description: category.description,
    accent: category.accent,
    index,
    unlocked: category.skills.some((skill) => state.get(skill.id)?.status !== "locked"),
    progress: Math.round(
      category.skills.reduce((sum, skill) => sum + (state.get(skill.id)?.progress || 0), 0) / category.skills.length,
    ),
    skills: category.skills.map((skill) => ({
      ...skill,
      ...state.get(skill.id),
      categoryKey: category.key,
      categoryName: category.name,
      accent: category.accent,
    })),
  }));

  const nodes = categories.flatMap((category) => [
    {
      id: category.id,
      type: "category",
      name: category.name,
      categoryKey: category.id,
      accent: category.accent,
      status: category.unlocked ? "unlocked" : "locked",
      progress: category.progress,
      level: 0,
      x: 90,
      y: 95 + category.index * 155,
    },
    ...category.skills.map((skill, skillIndex) => ({
      ...skill,
      type: "skill",
      x: 270 + skill.level * 160,
      y: 80 + category.index * 155 + skillIndex * 34,
    })),
  ]);

  const edges = [];
  categories.forEach((category) => {
    category.skills.forEach((skill) => {
      if (skill.prerequisites.length === 0) {
        edges.push({ from: category.id, to: skill.id, unlocked: state.get(skill.id)?.status !== "locked" });
        return;
      }
      skill.prerequisites.forEach((prerequisite) => {
        edges.push({
          from: SKILL_MAP.has(prerequisite) ? prerequisite : category.id,
          to: skill.id,
          unlocked: state.get(skill.id)?.status !== "locked",
        });
      });
    });
  });

  return { categories, nodes, edges, meta };
};

const computeStreak = (dates) => {
  const dayKeys = [...new Set(dates.filter(Boolean).map((date) => new Date(date).toISOString().slice(0, 10)))].sort().reverse();
  if (dayKeys.length === 0) return 0;

  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  for (const day of dayKeys) {
    const expected = cursor.toISOString().slice(0, 10);
    if (day !== expected && streak === 0) {
      cursor.setDate(cursor.getDate() - 1);
      if (day !== cursor.toISOString().slice(0, 10)) break;
    }
    if (day === cursor.toISOString().slice(0, 10)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  return streak;
};

const rebuildSkillProgression = async (userId, event = null) => {
  const [user, projects, assessments] = await Promise.all([
    User.findById(userId),
    Project.find({ user: userId }),
    VerificationResult.find({ candidateId: userId }),
  ]);

  if (!user) return null;

  const previousSkills = user.skillProgress?.skills || [];
  const state = createBaseSkillState();
  const activityDates = [];

  previousSkills.forEach((previousSkill) => {
    (previousSkill.evidence || [])
      .filter((evidence) => ["demo_assessment", "manual_event"].includes(evidence.type))
      .forEach((evidence) => {
        bumpSkill(state, previousSkill.id, {
          score: evidence.score || 75,
          xp: evidence.score >= 85 ? 180 : 80,
          type: evidence.type,
          source: evidence.source,
          label: evidence.label,
          completed: evidence.score >= 85,
        });
        activityDates.push(evidence.createdAt);
      });
  });

  projects.forEach((project) => {
    const textValues = [
      project.title,
      project.description,
      ...(project.technologies || []),
      ...Object.keys(project.githubStats?.languages || {}),
    ];
    const skillIds = getSkillIdsFromText(textValues);
    const score = project.isVerified || project.status === "Verified" ? 92 : 52;
    const xp = project.isVerified || project.status === "Verified" ? 130 : 55;
    skillIds.forEach((skillId) => {
      bumpSkill(state, skillId, {
        score,
        xp,
        type: project.isVerified ? "verified_project" : "project",
        source: project._id.toString(),
        label: project.title,
        completed: Boolean(project.isVerified || project.status === "Verified"),
      });
    });
    activityDates.push(project.updatedAt || project.createdAt);
  });

  user.certificates.forEach((certificate) => {
    const skillIds = getSkillIdsFromText([certificate.title, certificate.issuer, ...(certificate.techStack || [])]);
    skillIds.forEach((skillId) => {
      bumpSkill(state, skillId, {
        score: 88,
        xp: 145,
        type: "exam",
        source: certificate.credentialId || certificate.title,
        label: certificate.title,
        completed: true,
      });
    });
    activityDates.push(certificate.issuedAt);
  });

  assessments.forEach((assessment) => {
    const skillIds = getSkillIdsFromText([assessment.resumeText, assessment.status]);
    const verified = assessment.status === "Verified";
    skillIds.forEach((skillId) => {
      bumpSkill(state, skillId, {
        score: Math.max(assessment.alignmentScore || 0, assessment.examScore || 0, verified ? 82 : 45),
        xp: verified ? 150 : 60,
        type: "recruiter_assessment",
        source: assessment._id.toString(),
        label: `Recruiter assessment: ${assessment.status}`,
        completed: verified,
      });
    });
    activityDates.push(assessment.updatedAt || assessment.createdAt);
  });

  if (event) {
    const skillIds = event.skillIds?.length ? event.skillIds : getSkillIdsFromText([event.label, ...(event.technologies || [])]);
    skillIds.forEach((skillId) => {
      bumpSkill(state, skillId, {
        score: event.score || 75,
        xp: event.xp || 80,
        type: event.type || "manual_event",
        source: event.source || "system",
        label: event.label || "Progression event",
        completed: Boolean(event.completed),
      });
    });
    activityDates.push(new Date());
  }

  resolveUnlocks(state);

  const skills = [...state.values()];
  const totalXp = skills.reduce((sum, skill) => sum + skill.xp, 0);
  const verifiedCount = skills.filter((skill) => skill.status === "verified").length;
  const unlockedCount = skills.filter((skill) => skill.status !== "locked").length;
  const progressPercent = Math.round(skills.reduce((sum, skill) => sum + skill.progress, 0) / skills.length);
  const verificationScore = Math.round(skills.reduce((sum, skill) => sum + skill.verificationScore, 0) / skills.length);
  const githubScore = Math.min(100, Math.round(projects.length * 10 + projects.filter((project) => project.repositoryUrl?.includes("github.com")).length * 12));
  const trustScore = Math.round(verificationScore * 0.45 + progressPercent * 0.25 + githubScore * 0.2 + Math.min(100, verifiedCount * 10) * 0.1);
  const meta = {
    totalXp,
    level: levelFromXp(totalXp),
    verifiedCount,
    unlockedCount,
    totalSkills: skills.length,
    progressPercent,
    verificationScore,
    githubScore,
    trustScore,
    streakDays: computeStreak(activityDates),
    lastUpdated: new Date(),
  };

  user.skillProgress = {
    skills,
    completedAssessments: user.certificates.length + assessments.filter((assessment) => assessment.status === "Verified").length,
    achievements: deriveAchievements(state, meta),
    ...meta,
  };

  user.skillTree = {
    nodes: buildGraph(state, meta).nodes,
    generatedAt: new Date(),
    sourceHash: "deterministic-progression",
  };

  await user.save();
  return buildGraph(state, meta);
};

module.exports = {
  rebuildSkillProgression,
  getSkillIdsFromText,
};
