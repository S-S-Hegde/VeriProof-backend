/**
 * Deterministic skill and subject derivation.
 * Derived ONLY from the printed certificate title using a strict keyword map.
 * Never guesses or invents tags. If nothing matches, returns empty array.
 */
const TITLE_SKILL_MAP = [
  { keyword: /\bmachine learning\b/i, skills: ["Machine Learning", "Python"], subject: "Machine Learning & AI" },
  { keyword: /\bdeep learning\b/i, skills: ["Deep Learning", "Neural Networks"], subject: "Machine Learning & AI" },
  { keyword: /\bpython\b/i, skills: ["Python"], subject: "Software & Systems Engineering" },
  { keyword: /\bblockchain\b/i, skills: ["Blockchain", "Distributed Systems"], subject: "Blockchain & Web3" },
  { keyword: /\bnext gen(?:eration)? technologies\b/i, skills: ["Emerging Technologies", "Cloud Computing"], subject: "Software & Systems Engineering" },
  { keyword: /\bprogramming in c\b/i, skills: ["C", "Data Structures", "Algorithms"], subject: "Computer Science & Programming" },
  { keyword: /\bc\+\+\b/i, skills: ["C++", "Object Oriented Programming"], subject: "Computer Science & Programming" },
  { keyword: /\bjava\b/i, skills: ["Java", "OOP"], subject: "Software & Systems Engineering" },
  { keyword: /\bdata science\b/i, skills: ["Data Science", "Python", "Data Analysis"], subject: "Data Engineering & Analytics" },
  { keyword: /\bcybersecurity|security\b/i, skills: ["Cybersecurity", "Network Security"], subject: "Cybersecurity & InfoSec" },
  { keyword: /\baws|amazon web services\b/i, skills: ["AWS", "Cloud Architecture"], subject: "Cloud Architecture & DevOps" },
  { keyword: /\bazure\b/i, skills: ["Azure", "Cloud Computing"], subject: "Cloud Architecture & DevOps" },
  { keyword: /\bgcp|google cloud\b/i, skills: ["Google Cloud", "Cloud Computing"], subject: "Cloud Architecture & DevOps" },
  { keyword: /\bdevops\b/i, skills: ["DevOps", "CI/CD"], subject: "Cloud Architecture & DevOps" },
  { keyword: /\bfull stack|web development\b/i, skills: ["Full Stack Development", "JavaScript"], subject: "Full Stack Web Development" },
];

function deriveSkillsFromTitle(title) {
  if (!title || typeof title !== "string") return { skills: [], subject: null };

  const matchedSkills = new Set();
  let matchedSubject = null;

  for (const entry of TITLE_SKILL_MAP) {
    if (entry.keyword.test(title)) {
      entry.skills.forEach((s) => matchedSkills.add(s));
      if (!matchedSubject) matchedSubject = entry.subject;
    }
  }

  return {
    skills: Array.from(matchedSkills),
    subject: matchedSubject || null,
  };
}

module.exports = { deriveSkillsFromTitle };
