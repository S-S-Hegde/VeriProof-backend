const path = require("path");
const fs = require("fs");

let KEYWORDS_MAP = null;
try {
  const filePath = path.join(__dirname, "../../data/title_skill_keywords.json");
  if (fs.existsSync(filePath)) {
    KEYWORDS_MAP = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }
} catch (e) {
  KEYWORDS_MAP = {};
}

/**
 * Deterministic skill derivation.
 * Derived ONLY from the printed certificate title using the generic data file.
 * Never guesses or invents tags. If nothing matches, returns empty array.
 */
function deriveSkillsFromTitle(title) {
  if (!title || typeof title !== "string") return [];

  const matchedSkills = new Set();
  const lowerTitle = title.toLowerCase();

  const map = KEYWORDS_MAP || {};
  for (const [phrase, skills] of Object.entries(map)) {
    const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (regex.test(lowerTitle)) {
      skills.forEach((s) => matchedSkills.add(s));
    }
  }

  return Array.from(matchedSkills);
}

module.exports = { deriveSkillsFromTitle };
