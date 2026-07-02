const Question = require("../models/Question");

const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9+#.]/g, "");

const scoreClaimsAgainstJob = (claims = {}, job) => {
  const claimSkills = (claims.skills || []).map((skill) => skill.name).filter(Boolean);
  const claimedTokens = new Set(claimSkills.flatMap((skill) => [normalize(skill), ...String(skill).toLowerCase().split(/\s+/).map(normalize)]));
  const targetSkills = (job.targetSkills || []).map((skill) => String(skill).trim()).filter(Boolean);
  const matchedSkills = targetSkills.filter((skill) => claimedTokens.has(normalize(skill)));
  const missingSkills = targetSkills.filter((skill) => !matchedSkills.includes(skill));
  const alignmentScore = targetSkills.length ? Math.round((matchedSkills.length / targetSkills.length) * 100) : 100;
  return { alignmentScore, claimedSkills: claimSkills, matchedSkills, missingSkills };
};

const categoryForSkill = (skill) => {
  const value = String(skill).toLowerCase();
  if (value.includes("react")) return "React";
  if (value.includes("node") || value.includes("express")) return "Node.js";
  if (["mongo", "sql", "database", "mongoose", "postgres", "mysql"].some((term) => value.includes(term))) return "Database";
  if (["security", "auth", "jwt", "oauth", "network"].some((term) => value.includes(term))) return "Security";
  return null;
};

const selectAdaptiveQuestions = async (skills = [], limit = 10) => {
  const categories = [...new Set(skills.map(categoryForSkill).filter(Boolean))];
  let questions = [];
  if (categories.length) {
    questions = await Question.aggregate([
      { $match: { category: { $in: categories } } },
      { $sample: { size: limit } },
    ]);
  }
  if (questions.length < limit) {
    const excluded = questions.map((question) => question._id);
    const additional = await Question.aggregate([
      { $match: { _id: { $nin: excluded } } },
      { $sample: { size: limit - questions.length } },
    ]);
    questions.push(...additional);
  }
  return questions;
};

module.exports = { scoreClaimsAgainstJob, selectAdaptiveQuestions };
