/**
 * Utility to extract Academic / Education Records from resume text using regex patterns.
 */
const extractEducationFromText = (text = "") => {
  if (!text || typeof text !== "string") return {};

  const cleanText = text.replace(/\r\n/g, "\n");
  const result = {};

  // 1. CGPA / GPA / Percentage
  const cgpaMatch =
    cleanText.match(/(?:CGPA|GPA|Aggregate|Percentage|Marks)[\s:=-]+([0-9]+(?:\.[0-9]+)?(?:\s*\/\s*10(?:\.0)?)?|[0-9]{2}(?:\.[0-9]+)?%)/i) ||
    cleanText.match(/\b([789]\.[0-9]{1,2}(?:\s*\/\s*10(?:\.0)?)?)\b/);

  if (cgpaMatch) {
    result.cgpa = cgpaMatch[1]?.trim() || "";
  }

  // 2. USN / Roll Number / Student ID (e.g. VTU format: 1RN21CS001, 1RV20IS045 or generic)
  const usnMatch =
    cleanText.match(/\b([1-4][A-Za-z]{2}\d{2}[A-Za-z]{2}\d{3})\b/) ||
    cleanText.match(/(?:USN|Roll\s*No|Student\s*ID|Reg(?:istration)?\s*No)[\s:=-]+([A-Za-z0-9]+)/i);

  if (usnMatch) {
    result.usn = usnMatch[1]?.trim().toUpperCase() || "";
  }

  // 3. Batch / Graduation Year Range (e.g. 2021-2025, 2020-2024, 2022-2026)
  const batchMatch =
    cleanText.match(/\b(20\d{2}\s*[-–—]\s*20\d{2})\b/) ||
    cleanText.match(/\b(20\d{2}\s*Batch)\b/i) ||
    cleanText.match(/(?:Graduation|Passing\s*Year|Year\s*of\s*Passing|Batch)[\s:=-]+(20\d{2}(?:\s*-\s*20\d{2})?)/i);

  if (batchMatch) {
    result.batch = batchMatch[1]?.trim() || "";
  }

  // 4. Branch / Field of Specialization / Degree
  const branchMatch =
    cleanText.match(/(?:Bachelor|Master|B\.?E\.?|B\.?Tech\.?|M\.?Tech\.?|B\.?Sc\.?|BCA|MCA)(?:\s+(?:in|of)\s+([A-Za-z\s&,]+?)(?:\s*\(|\n|,|\.))/i) ||
    cleanText.match(/\b(Computer Science(?: and Engineering)?|Information Science(?: and Engineering)?|Artificial Intelligence(?: and Machine Learning)?|Data Science|Software Engineering|Electronics and Communication(?: Engineering)?|Mechanical Engineering|Civil Engineering)\b/i);

  if (branchMatch) {
    result.branch = branchMatch[1]?.trim() || branchMatch[0]?.trim() || "";
  }

  // 5. Institution / College / University Identifier
  const collegeMatch =
    cleanText.match(/([A-Za-z\s.&'-]+(?:Institute of Technology|Institute of Engineering|University|College of Engineering|Engineering College|Polytechnic|Academy)(?:\s+of\s+[A-Za-z\s.&'-]+)?)/i) ||
    cleanText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,5}\s+(?:Institute|University|College|School))/);

  if (collegeMatch) {
    result.college = collegeMatch[1]?.replace(/\n/g, " ").replace(/\s+/g, " ").trim().substring(0, 85) || "";
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

  return result;
};

module.exports = {
  extractEducationFromText,
};
