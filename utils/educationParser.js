/**
 * Utility to extract Academic / Education Records & Network Nodes from resume text.
 */
const extractEducationFromText = (text = "") => {
  if (!text || typeof text !== "string") return {};

  const cleanText = text.replace(/\r\n/g, "\n");
  const result = {};

  // 1. CGPA / GPA / Percentage
  const cgpaMatch =
    cleanText.match(/(?:CGPA|GPA|Aggregate|Percentage|Marks)[\s:=-]+([0-9]+(?:\.[0-9]+)?(?:\s*\/\s*10(?:\.0)?)?|[0-9]{2}(?:\.[0-9]+)?%)/i) ||
    cleanText.match(/\b([789]\.[0-9]{1,2}(?:\s*\/\s*10)?)\b/);

  if (cgpaMatch) {
    result.cgpa = cgpaMatch[1]?.trim() || "";
  }

  // 2. USN / Roll Number / Student ID (e.g. VTU format: 4SU21IS045, 1RN21CS001, 1RV20IS045, etc.)
  const usnMatch =
    cleanText.match(/\b([1-4][A-Za-z]{2}\d{2}[A-Za-z]{2}\d{3})\b/) ||
    cleanText.match(/(?:USN|Roll\s*(?:No|Number)|Student\s*ID|Reg(?:istration)?\s*(?:No|Number))[\s:=-]+([A-Za-z0-9]+)/i);

  if (usnMatch) {
    result.usn = usnMatch[1]?.trim().toUpperCase() || "";
  }

  // 3. Batch / Graduation Year Range (e.g. 2021-2025, 2021 - 2025, 2025, Expected 2025)
  const batchMatch =
    cleanText.match(/\b(20\d{2}\s*[-–—]\s*(?:20)?\d{2})\b/) ||
    cleanText.match(/(?:Graduation|Passing\s*Year|Year\s*of\s*Passing|Batch|Class\s*of|Expected)[\s:=-]+(?:[A-Za-z]+\s+)?(20\d{2}(?:\s*[-–—]\s*(?:20)?\d{2})?)/i) ||
    cleanText.match(/\b(?:Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul)?\s*20\d{2}\s*[-–—]\s*(?:(?:Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul)?\s*)?(20\d{2})\b/i) ||
    cleanText.match(/\b(202[1-9])\b/);

  if (batchMatch) {
    result.batch = (batchMatch[1] || batchMatch[0])?.trim() || "";
  }

  // 4. Branch / Field of Specialization / Degree
  const branchMatch =
    cleanText.match(/(?:Bachelor|Master|B\.?E\.?|B\.?Tech\.?|M\.?Tech\.?|B\.?Sc\.?|BCA|MCA)(?:\s+(?:in|of)\s+([A-Za-z\s&,]+?)(?:\s*\(|\n|,|\.))/i) ||
    cleanText.match(/\b(Information Science(?: and Engineering)?|Computer Science(?: and Engineering)?|Artificial Intelligence(?: and Machine Learning)?|Data Science|Software Engineering|Electronics and Communication(?: Engineering)?|Mechanical Engineering|Civil Engineering)\b/i);

  if (branchMatch) {
    result.branch = branchMatch[1]?.trim() || branchMatch[0]?.trim() || "";
  }

  // 5. Institution / College / University Identifier (Strict Clean Match)
  // Target: "SDM Institute of Technology", "Sahyadri College of Engineering", etc.
  const collegeMatch =
    cleanText.match(/\b([A-Z0-9&.\s'-]{1,35}\s+(?:Institute of Technology|Institute of Engineering|College of Engineering|Engineering College|Institute of Science|University|College|Polytechnic|Academy)(?:\s+of\s+[A-Za-z\s.&'-]+)?)/);

  if (collegeMatch) {
    let cleanCollege = collegeMatch[1]
      .replace(/[\n\r]+/g, " ")
      .replace(/^(?:EDUCATION|COLLEGE|ACADEMICS|INSTITUTE|UNIVERSITY|DEGREE|SCHOOL|AND|THE|SERVICES|\.|\:|\-|\s)+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    result.college = cleanCollege.substring(0, 70);
  }

  // 6. Phone number
  const phoneMatch = cleanText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
  if (phoneMatch) {
    result.phone = phoneMatch[0].trim();
  }

  // 7. Location (City, State)
  const locMatch = cleanText.match(/\b([A-Z][a-z]+(?:[\s-][A-Z][a-z]+)?,\s*(?:Karnataka|Maharashtra|Tamil Nadu|Delhi|Telangana|California|New York|India|USA|UK))\b/);
  if (locMatch) {
    result.location = locMatch[1].trim();
  }

  // 8. LinkedIn URL or handle
  const linkedinMatch =
    cleanText.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([A-Za-z0-9_-]+)/i) ||
    cleanText.match(/linkedin\.com\/in\/([A-Za-z0-9_-]+)/i);
  if (linkedinMatch) {
    result.linkedin = `https://linkedin.com/in/${linkedinMatch[1]}`;
  }

  // 9. GitHub URL or username
  const githubMatch =
    cleanText.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_-]+)/i) ||
    cleanText.match(/github\.com\/([A-Za-z0-9_-]+)/i);
  if (githubMatch) {
    result.githubUsername = githubMatch[1];
  }

  // 10. Portfolio Website URL
  const websiteMatch = cleanText.match(/(https?:\/\/[a-zA-Z0-9.-]+\.(?:vercel\.app|netlify\.app|github\.io|dev|io|tech|me|com)(?:\/[^\s]*)?)/i);
  if (websiteMatch) {
    result.website = websiteMatch[1];
  }

  // 11. Twitter / X handle
  const twitterMatch =
    cleanText.match(/(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/i);
  if (twitterMatch) {
    result.twitter = twitterMatch[1];
  }

  return result;
};

module.exports = {
  extractEducationFromText,
};
