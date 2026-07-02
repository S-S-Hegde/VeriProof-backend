const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const User = require("../models/User");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const { flatSkillCatalog } = require("../data/skillCatalog");
const mongoose = require("mongoose");

// Helper: Normalize raw text before parsing
const normalizeText = (rawText) => {
  if (!rawText) return "";
  
  let text = rawText;
  
  // 1. Remove non-printable/ASCII control characters (keep common whitespace)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
  
  // 2. Normalize carriage returns and other line breaks to standard Unix \n
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  
  // 3. Replace multiple consecutive spaces or tabs with a single space
  text = text.replace(/[ \t]+/g, " ");
  
  // 4. Clean up trailing/leading spacing per line
  text = text.split("\n").map(line => line.trim()).join("\n");
  
  // 5. Replace multiple consecutive newlines with at most double newlines to preserve paragraph layout
  text = text.replace(/\n{3,}/g, "\n\n");
  
  // 6. Normalize section headers to help parsing engines (both Gemini and regex fallback)
  text = text.replace(/work\s+experience|professional\s+experience|employment\s+history/gi, "EXPERIENCE");
  text = text.replace(/academic\s+records|educational\s+background|education/gi, "EDUCATION");
  text = text.replace(/projects\s+undertaken|academic\s+projects|personal\s+projects|projects/gi, "PROJECTS");
  text = text.replace(/technical\s+skills|skills\s+&amp;\s+abilities|core\s+competencies|skills/gi, "SKILLS");
  text = text.replace(/certifications|licenses\s+&amp;\s+certifications/gi, "CERTIFICATIONS");

  return text.trim();
};

const containsSkillTrigger = (text, trigger) => {
  const escaped = trigger.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const needsBoundaries = /^[a-z0-9]+$/.test(trigger) && trigger.length <= 4;
  return needsBoundaries
    ? new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text)
    : text.includes(trigger.toLowerCase());
};

// Helper: download file from URL (local or Cloudinary)
const downloadFile = async (fileUrl) => {
  // Local file check
  if (fileUrl.startsWith("/uploads/")) {
    const localPath = path.join(__dirname, "..", fileUrl);
    if (!fs.existsSync(localPath)) {
      throw new Error(`Local file not found: ${localPath}`);
    }
    return fs.readFileSync(localPath);
  }
  
  // External URL download
  const response = await axios.get(fileUrl, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
};

const extractTextFromBuffer = async (buffer, mimeType = "application/pdf", fileName = "") => {
  const extension = path.extname(fileName).toLowerCase();
  if (mimeType === "application/pdf" || extension === ".pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || "";
    } finally {
      await parser.destroy();
    }
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || extension === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }
  if (mimeType === "text/plain" || extension === ".txt") {
    return buffer.toString("utf8");
  }
  throw new Error("Unsupported resume format. Upload PDF, DOCX, or TXT.");
};

// Heuristic Fallback Parser (Regex and Skill Catalog triggers)
const deterministicFallbackParse = (text, userProfile = {}) => {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const phoneRegex = /\+?\d{1,4}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g;
  const githubRegex = /github\.com\/([a-zA-Z0-9_-]+)/i;
  const linkedinRegex = /linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i;
  
  const emails = text.match(emailRegex) || [];
  const phones = text.match(phoneRegex) || [];
  const githubMatch = text.match(githubRegex);
  const linkedinMatch = text.match(linkedinRegex);
  
  // Skill extraction using flat catalog triggers
  const matchedSkillIds = new Set();
  const textLower = text.toLowerCase();
  
  // Re-read flat catalog directly to avoid import issues
  const skillCatalogModule = require("../data/skillCatalog");
  const flatCatalog = skillCatalogModule.flatSkillCatalog || [];
  
  flatCatalog.forEach((skill) => {
    if (skill.triggers && skill.triggers.some((trigger) => containsSkillTrigger(textLower, trigger))) {
      matchedSkillIds.add(skill.id);
    }
  });

  const skills = Array.from(matchedSkillIds).map(id => {
    const catalogItem = flatCatalog.find(s => s.id === id);
    return {
      id,
      name: catalogItem ? catalogItem.name : (id.charAt(0).toUpperCase() + id.slice(1)),
      source: "Resume",
      verificationStatus: "Pending",
      evidenceCount: 0
    };
  });

  // Extract contact info
  const fullName = userProfile.name || "Candidate Name";
  const email = emails[0] || userProfile.email || "";
  const phone = phones[0] || userProfile.phone || "";
  const githubUrl = githubMatch ? `https://${githubMatch[0]}` : "";
  const linkedinUrl = linkedinMatch ? `https://${linkedinMatch[0]}` : "";

  // Education heuristic
  const education = [];
  const eduKeywords = ["university", "college", "institute", "school", "btech", "b.tech", "b.e", "bachelor", "master", "mca", "bca", "mtech"];
  const lines = text.split("\n");
  lines.forEach((line, idx) => {
    const lineLower = line.toLowerCase();
    if (eduKeywords.some(keyword => lineLower.includes(keyword)) && education.length < 3) {
      // Find graduation year in line
      const yearMatch = line.match(/\b(19|20)\d{2}\b/);
      education.push({
        id: `edu-${idx}`,
        degree: line.substring(0, 50).trim(),
        university: line.substring(0, 100).trim(),
        graduationYear: yearMatch ? yearMatch[0] : "",
        verificationStatus: "Pending"
      });
    }
  });

  // Projects heuristic
  const projects = [];
  lines.forEach((line, idx) => {
    if ((line.toLowerCase().startsWith("project:") || line.toLowerCase().includes("developed a")) && projects.length < 5) {
      projects.push({
        id: `proj-${idx}`,
        title: line.substring(0, 50).trim(),
        description: line.substring(0, 200).trim(),
        verificationStatus: "Pending",
        evidenceCount: 0
      });
    }
  });

  // Experience heuristic
  const experience = [];
  lines.forEach((line, idx) => {
    if ((line.toLowerCase().includes("intern") || line.toLowerCase().includes("developer at") || line.toLowerCase().includes("engineer at")) && experience.length < 4) {
      experience.push({
        id: `exp-${idx}`,
        role: line.substring(0, 50).trim(),
        company: line.substring(0, 50).trim(),
        verificationStatus: "Pending"
      });
    }
  });

  // Certifications heuristic
  const certifications = [];
  lines.forEach((line, idx) => {
    if ((line.toLowerCase().includes("certified") || line.toLowerCase().includes("certification")) && certifications.length < 4) {
      certifications.push({
        id: `cert-${idx}`,
        name: line.substring(0, 80).trim(),
        verificationStatus: "Pending"
      });
    }
  });

  return {
    claims: {
      skills,
      projects,
      certifications,
      education,
      experience,
      contactInfo: { fullName, email, phone, githubUrl, linkedinUrl }
    },
    analysis: {
      missingFields: [],
      parsingConfidence: 55, // Moderate fallback parsing confidence
      resumeCompleteness: Math.round(
        ((skills.length ? 1 : 0) + (education.length ? 1 : 0) + (projects.length ? 1 : 0) + (email ? 1 : 0) + (phone ? 1 : 0)) * 20
      ),
      parseErrors: []
    }
  };
};

// AI/Gemini-Based Parser
const geminiParse = async (apiKey, text, userProfile = {}) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `You are an expert AI resume parser. Extract structured information from the following normalized resume text.

Normalized Resume Text:
"""
${text}
"""

You must respond with a JSON object ONLY, matching this schema:
{
  "fullName": "extracted full name or empty string",
  "email": "extracted email or empty string",
  "phone": "extracted phone or empty string",
  "githubUrl": "extracted github profile url or empty string",
  "linkedinUrl": "extracted linkedin profile url or empty string",
  "education": [
    {
      "degree": "extracted degree",
      "university": "extracted university",
      "graduationYear": "extracted graduation year (YYYY format)"
    }
  ],
  "skills": ["extracted skill 1 name", "extracted skill 2 name", ...],
  "programmingLanguages": ["extracted language 1", ...],
  "frameworks": ["extracted framework 1", ...],
  "databases": ["extracted database 1", ...],
  "tools": ["extracted tool 1", ...],
  "certifications": ["extracted certification name 1", ...],
  "projects": [
    {
      "title": "extracted project title",
      "description": "extracted project description or empty string"
    }
  ],
  "experience": [
    {
      "role": "extracted job role / designation",
      "company": "extracted company name"
    }
  ]
}

Ensure the response contains ONLY the raw JSON block without markdown prefix/suffix. Do not include formatting wrappers.`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text().trim();
  
  // Clean potential markdown wrapper
  let jsonString = responseText;
  if (jsonString.startsWith("```json")) {
    jsonString = jsonString.substring(7);
  }
  if (jsonString.startsWith("```")) {
    jsonString = jsonString.substring(3);
  }
  if (jsonString.endsWith("```")) {
    jsonString = jsonString.substring(0, jsonString.length - 3);
  }
  jsonString = jsonString.trim();

  const parsed = JSON.parse(jsonString);

  // Map to structured claims repository schema
  const skillCatalogModule = require("../data/skillCatalog");
  const flatCatalog = skillCatalogModule.flatSkillCatalog || [];
  
  // Map extracted skills to catalog IDs where applicable
  const skillsList = [...new Set([
    ...(parsed.skills || []),
    ...(parsed.programmingLanguages || []),
    ...(parsed.frameworks || []),
    ...(parsed.databases || []),
    ...(parsed.tools || []),
  ].map((skill) => String(skill).trim()).filter(Boolean))];
  const skills = skillsList.map((skillName, idx) => {
    // Try to find matching catalog item
    const matched = flatCatalog.find(s => 
      s.name.toLowerCase() === skillName.toLowerCase() ||
      s.triggers.some(t => t.toLowerCase() === skillName.toLowerCase())
    );
    return {
      id: matched ? matched.id : `skill-${idx}`,
      name: matched ? matched.name : skillName,
      source: "Resume",
      verificationStatus: "Pending",
      evidenceCount: 0
    };
  });

  const education = (parsed.education || []).map((edu, idx) => ({
    id: `edu-${idx}`,
    degree: edu.degree || "",
    university: edu.university || "",
    graduationYear: edu.graduationYear || "",
    verificationStatus: "Pending"
  }));

  const projects = (parsed.projects || []).map((proj, idx) => ({
    id: `proj-${idx}`,
    title: proj.title || "",
    description: proj.description || "",
    verificationStatus: "Pending",
    evidenceCount: 0
  }));

  const certifications = (parsed.certifications || []).map((cert, idx) => ({
    id: `cert-${idx}`,
    name: cert || "",
    verificationStatus: "Pending"
  }));

  const experience = (parsed.experience || []).map((exp, idx) => ({
    id: `exp-${idx}`,
    role: exp.role || "",
    company: exp.company || "",
    verificationStatus: "Pending"
  }));

  const contactInfo = {
    fullName: parsed.fullName || userProfile.name || "",
    email: parsed.email || userProfile.email || "",
    phone: parsed.phone || userProfile.phone || "",
    githubUrl: parsed.githubUrl || "",
    linkedinUrl: parsed.linkedinUrl || "",
  };

  // Determine missing fields
  const missingFields = [];
  if (!contactInfo.email) missingFields.push("Email Address");
  if (!contactInfo.phone) missingFields.push("Phone Number");
  if (!skills.length) missingFields.push("Skills Section");
  if (!education.length) missingFields.push("Education History");
  if (!projects.length) missingFields.push("Projects");

  const resumeCompleteness = Math.round(
    ((skills.length ? 1 : 0) + (education.length ? 1 : 0) + (projects.length ? 1 : 0) + (contactInfo.email ? 1 : 0) + (contactInfo.phone ? 1 : 0)) * 20
  );

  return {
    claims: {
      skills,
      projects,
      certifications,
      education,
      experience,
      contactInfo
    },
    analysis: {
      missingFields,
      parsingConfidence: 95, // High confidence with Gemini model
      resumeCompleteness,
      parseErrors: []
    }
  };
};

// Main Asynchronous orchestrator
const parseResumeText = async (rawText, userProfile = {}) => {
  const normalizedText = normalizeText(rawText);
  if (!normalizedText) throw new Error("No readable text was found in the resume.");

  let parseResult;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey?.trim()) {
    try {
      parseResult = await geminiParse(geminiKey, normalizedText, userProfile);
    } catch (geminiError) {
      console.error("[Resume Intelligence] Gemini parse failed; using deterministic parser:", geminiError.message);
      parseResult = deterministicFallbackParse(normalizedText, userProfile);
      parseResult.analysis.parseErrors = [geminiError.message];
    }
  } else {
    parseResult = deterministicFallbackParse(normalizedText, userProfile);
  }
  return { normalizedText, ...parseResult };
};

const analyzeResumeBuffer = async (buffer, { mimeType, fileName, userProfile = {} } = {}) => {
  const rawText = await extractTextFromBuffer(buffer, mimeType, fileName);
  return parseResumeText(rawText, userProfile);
};

const runAnalysis = async (userId, resumeUrl, fileMetadata = {}) => {
  let analysisRecord = null;
  try {
    console.log(`[Resume Intelligence] Starting parse for User ${userId}`);
    
    // Set older analysis records to active: false
    await ResumeAnalysis.updateMany({ candidateId: userId }, { active: false });
    
    // Initial Queued document
    analysisRecord = await ResumeAnalysis.create({
      candidateId: userId,
      status: "Queued",
      progress: 5,
      stage: "Queued for processing",
      estimatedRemainingStage: "45s",
      active: true,
      resumeUrl,
      originalFileName: fileMetadata.originalFileName || "",
      mimeType: fileMetadata.mimeType || "application/pdf",
      processedAt: new Date()
    });

    const user = await User.findById(userId);
    if (!user) throw new Error("Candidate user record not found");

    // ── STAGE 1: PARSING & NORMALIZATION (25%) ──
    analysisRecord.status = "Parsing";
    analysisRecord.progress = 25;
    analysisRecord.stage = "Downloading and extracting text from resume";
    analysisRecord.estimatedRemainingStage = "35s";
    await analysisRecord.save();

    const buffer = await downloadFile(resumeUrl);
    const rawText = await extractTextFromBuffer(
      buffer,
      fileMetadata.mimeType || "application/pdf",
      fileMetadata.originalFileName || resumeUrl,
    );
    const normalizedText = normalizeText(rawText);
    analysisRecord.truncatedText = normalizedText.substring(0, 2000); // Truncate text block to avoid DB clutter
    await analysisRecord.save();

    // ── STAGE 2: EXTRACTING INFORMATION (55%) ──
    analysisRecord.status = "Extracting Information";
    analysisRecord.progress = 55;
    analysisRecord.stage = "Extracting structured claims and contact info";
    analysisRecord.estimatedRemainingStage = "20s";
    await analysisRecord.save();

    const { normalizedText: parsedText, ...parseResult } = await parseResumeText(normalizedText, user);
    analysisRecord.truncatedText = parsedText.substring(0, 2000);

    // Save extracted claims and analysis
    analysisRecord.claims = parseResult.claims;
    analysisRecord.analysis = parseResult.analysis;
    analysisRecord.processedAt = new Date();
    await analysisRecord.save();

    // ── STAGE 3: UPDATING SKILL TREE (80%) ──
    analysisRecord.status = "Updating Skill Tree";
    analysisRecord.progress = 80;
    analysisRecord.stage = "Syncing extracted claims to onboarding state";
    analysisRecord.estimatedRemainingStage = "5s";
    await analysisRecord.save();

    // Update user profile status without verifying them automatically
    user.resumeStatus = "Analyzed";
    
    // Optionally update user's profile github/linkedin details if extracted from resume
    const claimsContact = parseResult.claims.contactInfo;
    if (claimsContact.githubUrl && !user.githubUsername) {
      // Extract username from github URL
      const matches = claimsContact.githubUrl.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
      if (matches && matches[1]) {
        user.githubUsername = matches[1];
      }
    }
    if (claimsContact.linkedinUrl && !user.linkedin) {
      user.linkedin = claimsContact.linkedinUrl;
    }
    
    await user.save();

    // ── STAGE 4: ANALYSIS COMPLETE (100%) ──
    analysisRecord.status = "Analysis Complete";
    analysisRecord.progress = 100;
    analysisRecord.stage = "Resume analysis complete. Claims stored.";
    analysisRecord.estimatedRemainingStage = "0s";
    await analysisRecord.save();
    
    console.log(`[Resume Intelligence] Analysis completed successfully for candidate: ${userId}`);
  } catch (error) {
    console.error(`[Resume Intelligence] Analysis failed for candidate: ${userId}`, error);
    if (analysisRecord) {
      analysisRecord.status = "Analysis Failed";
      analysisRecord.progress = 100;
      analysisRecord.stage = "Analysis failed due to error";
      analysisRecord.estimatedRemainingStage = "0s";
      analysisRecord.error = error.message;
      await analysisRecord.save();
    }
    
    // Reset user status on failure so they can re-upload
    try {
      const user = await User.findById(userId);
      if (user) {
        user.resumeStatus = "Rejected";
        await user.save();
      }
    } catch (userSaveError) {
      console.error("[Resume Intelligence] Reset user status failure:", userSaveError);
    }
  }
};

module.exports = {
  runAnalysis,
  normalizeText,
  extractTextFromBuffer,
  parseResumeText,
  analyzeResumeBuffer,
};
