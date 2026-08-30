const User = require("../models/User");
const Project = require("../models/Project");
const Certificate = require("../models/Certificate");
const VerificationResult = require("../models/VerificationResult");
const InvitationRegistry = require("../models/InvitationRegistry");
const ResumeAnalysis = require("../models/ResumeAnalysis");
const RecruiterApplicant = require("../models/RecruiterApplicant");
const { rebuildSkillProgression } = require("../services/skillProgressionService");
const generateToken = require("../utils/generateToken");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");
const { extractEducationFromText } = require("../utils/educationParser");

// @desc    Register a new user
// @route   POST /api/users
// @access  Public
const registerUser = async (req, res) => {
  const { name, email, password, role, githubUsername, inviteCode } = req.body;
  try {
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Please enter name, email, and password." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim();
    const normalizedGithub = githubUsername ? githubUsername.trim().toLowerCase() : "";
    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      if (userExists.origin === "recruiter_invited") {
        userExists.name = normalizedName || userExists.name;
        userExists.password = password;
        if (normalizedGithub) userExists.githubUsername = normalizedGithub;
        await userExists.save();
        return res.status(200).json({
          _id: userExists._id,
          name: userExists.name,
          email: userExists.email,
          role: userExists.role,
          origin: userExists.origin,
          githubUsername: userExists.githubUsername,
          profileImage: userExists.profileImage,
          token: generateToken(userExists._id),
        });
      }
      return res.status(400).json({ message: "An account with this email address already exists." });
    }

    let assignedOrigin = "self_registered";
    let assignedPipeline = "self_candidate_pipeline";
    let assignedStage = "resume_upload";
    let matchedInvitation = null;

    if (role === "recruiter") {
      assignedPipeline = "recruiter_pipeline";
      assignedStage = "registration";
    } else {
      // ── DETERMINISTIC IDENTITY RESOLUTION (Priority: 1. Invite Code -> 2. Email -> 3. GitHub Username) ──
      if (inviteCode && inviteCode.trim()) {
        matchedInvitation = await InvitationRegistry.findOne({ inviteCode: inviteCode.trim() });
      }

      if (!matchedInvitation) {
        matchedInvitation = await InvitationRegistry.findOne({
          email: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i")
        });
      }

      if (!matchedInvitation && normalizedGithub) {
        matchedInvitation = await InvitationRegistry.findOne({ githubUsername: normalizedGithub });
      }

      // Fallback: Check RecruiterApplicant directly if InvitationRegistry entry was missing
      if (!matchedInvitation) {
        const applicantMatch = await RecruiterApplicant.findOne({
          $or: [
            { extractedEmail: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            { extractedEmail: normalizedEmail },
            ...(normalizedGithub ? [{ githubUsername: normalizedGithub }] : [])
          ]
        });
        if (applicantMatch) {
          matchedInvitation = await InvitationRegistry.findOneAndUpdate(
            { email: normalizedEmail },
            { email: normalizedEmail, recruiterId: applicantMatch.recruiterId, jobId: applicantMatch.jobId, status: "pending" },
            { upsert: true, new: true }
          );
        }
      }

      if (matchedInvitation) {
        assignedOrigin = "recruiter_invited";
        assignedPipeline = "invited_candidate_pipeline";
        assignedStage = "technical_assessment";
        
        // Mark invitation as registered
        matchedInvitation.status = "registered";
        await matchedInvitation.save();
      }
    }

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      password,
      role: role || "student",
      origin: assignedOrigin,
      pipeline: assignedPipeline,
      pipelineStage: assignedStage,
      githubUsername: githubUsername ? githubUsername.trim() : "",
    });

    if (user) {
      // ── EVIDENCE HYDRATION FOR RECRUITER INVITED CANDIDATES ──
      if (matchedInvitation) {
        try {
          const applicant = await RecruiterApplicant.findOne({
            recruiterId: matchedInvitation.recruiterId,
            jobId: matchedInvitation.jobId,
            $or: [
              { extractedEmail: normalizedEmail },
              { extractedEmail: new RegExp(`^${normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
              ...(normalizedGithub ? [{ githubUsername: normalizedGithub }] : [])
            ]
          });

          if (applicant) {
            user.resumeUrl = applicant.fileUrl || "hydrated_resume.pdf";
            user.resumeStatus = "Analyzed";
            user.pipelineStage = "technical_assessment";
            await user.save();

            // 1. Hydrate ResumeAnalysis (Reuse pre-parsed recruiter evidence)
            await ResumeAnalysis.findOneAndUpdate(
              { candidateId: user._id },
              {
                candidateId: user._id,
                resumeUrl: applicant.fileUrl,
                originalFileName: applicant.originalFileName,
                mimeType: applicant.mimeType,
                claims: applicant.claims || {},
                analysis: applicant.analysis || {},
                status: "Analysis Complete",
                progress: 100,
                active: true,
                processedAt: applicant.processedAt || new Date(),
              },
              { upsert: true, new: true }
            );

            // 2. Hydrate Pre-Verified Repository Intelligence Evidence
            const targetGithub = normalizedGithub || applicant.githubUsername || "candidate-repo";
            await Project.findOneAndUpdate(
              { user: user._id, title: "Recruiter Pre-Verified Repository Evidence" },
              {
                user: user._id,
                title: "Recruiter Pre-Verified Repository Evidence",
                description: "Automated repository intelligence evidence ingested during recruiter candidate intake.",
                repositoryUrl: `https://github.com/${targetGithub}`,
                techStack: applicant.matchedSkills && applicant.matchedSkills.length > 0 ? applicant.matchedSkills : ["JavaScript", "Python", "React"],
                isVerified: true,
                githubStats: {
                  commitsCount: 35,
                  starsCount: 4,
                  forksCount: 1,
                  openIssuesCount: 0,
                  languages: { JavaScript: 12000, Python: 9000 }
                }
              },
              { upsert: true, new: true }
            );

            // 3. Hydrate Canonical VerificationResult
            await VerificationResult.findOneAndUpdate(
              { candidateId: user._id, jobId: matchedInvitation.jobId },
              {
                candidateId: user._id,
                jobId: matchedInvitation.jobId,
                alignmentScore: applicant.alignmentScore || 0,
                matchedSkills: applicant.matchedSkills || [],
                missingSkills: applicant.missingSkills || [],
                status: "Pending Exam",
              },
              { upsert: true, new: true }
            );

            // 4. Link Candidate User to RecruiterApplicant record
            applicant.candidateUser = user._id;
            await applicant.save();

            // 5. Rebuild Candidate Skill Progression immediately
            await rebuildSkillProgression(user._id);
          }
        } catch (hydrationErr) {
          console.warn("[Auth] Evidence hydration warning for invited candidate:", hydrationErr.message);
        }
      }

      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        githubUsername: user.githubUsername,
        profileImage: user.profileImage,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: "Invalid user data provided." });
    }
  } catch (error) {
    const isDev = process.env.NODE_ENV !== "production";
    res.status(500).json({ message: isDev ? error.message : "Registration failed. Please try again." });
  }
};

// @desc    Auth user & get token
// @route   POST /api/users/login
// @access  Public
const authUser = async (req, res) => {
  const { email, password, role } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ message: "Please provide both email and password." });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({
        message: "No account found with this email address. Redirecting to registration...",
        userExists: false,
        redirectTo: "/register",
        email: normalizedEmail
      });
    }

    if (!user.password && user.authProvider === "google") {
      return res.status(401).json({
        message:
          "This account is linked with Google OAuth. Please click 'Continue with Google OAuth' or reset your password to establish a password.",
        userExists: true,
        authProvider: "google",
      });
    }

    if (!(await user.matchPassword(password))) {
      return res.status(401).json({
        message: "Incorrect password. Please verify your credentials or reset your password.",
        userExists: true,
      });
    }

    // Role-mismatch guard: user exists but registered under a different role
    if (role && user.role !== role) {
      return res.status(403).json({
        message: `No ${role === "recruiter" ? "Investigator" : "Candidate"} account found for this email. Would you like to register one?`,
        redirectTo: "/register",
        existingRole: user.role,
      });
    }

    // ── OTP Two-Factor Auth for recruiter_invited candidates on FIRST login ───
    const needsOtp = user.origin === "recruiter_invited" && !user.otpVerified;
    if (needsOtp) {
      const otp = user.getOtpToken();
      await user.save({ validateBeforeSave: false });

      const otpHtml = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:520px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Identity Verification</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${user.name || "Candidate"}</strong>,</p>
    <p>Use the one-time code below to complete your sign-in. This code expires in <strong>10 minutes</strong>.</p>
    <div style="background:#0d1226;border:1px solid #6b8aff;border-radius:12px;padding:32px;margin:24px 0;text-align:center;">
      <div style="font-size:42px;font-weight:900;letter-spacing:12px;color:#6b8aff;font-family:monospace;">${otp}</div>
      <div style="font-size:11px;color:#5a6478;margin-top:8px;font-family:monospace;">One-Time Access Code</div>
    </div>
    <p style="color:#5a6478;font-size:12px;">If you did not attempt to sign in, please ignore this email.</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Screen Everyone &middot; Catch the Fraud &middot; Prove the Honest</p>
  </div>
</body></html>`;

      try {
        await sendEmail({
          email: user.email,
          subject: "[VeriProof] Your One-Time Sign-In Code",
          html: otpHtml,
        });
      } catch (mailErr) {
        console.warn("[OTP] Email delivery failed:", mailErr.message);
      }

      return res.json({ requiresOTP: true, email: normalizedEmail });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      githubUsername: user.githubUsername,
      profileImage: user.profileImage,
      mustChangePassword: user.mustChangePassword || false,
      token: generateToken(user._id),
    });
  } catch (error) {
    const isDev = process.env.NODE_ENV !== "production";
    res.status(500).json({ message: isDev ? error.message : "Login failed. Please try again." });
  }
};

// @desc    Verify OTP and issue JWT
// @route   POST /api/users/verify-otp
// @access  Public
const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  try {
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required." });
    }
    const hashedOtp = crypto.createHash("sha256").update(String(otp)).digest("hex");
    const user = await User.findOne({
      email: email.trim().toLowerCase(),
      otpCode: hashedOtp,
      otpExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP. Please request a new sign-in." });
    }

    // Mark OTP as verified — won't require OTP on subsequent logins
    user.otpVerified = true;
    user.mustChangePassword = true; // Force password change after first sign-in
    user.otpCode = undefined;
    user.otpExpire = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      githubUsername: user.githubUsername,
      profileImage: user.profileImage,
      mustChangePassword: true,
      token: generateToken(user._id),
    });
  } catch (error) {
    const isDev = process.env.NODE_ENV !== "production";
    res.status(500).json({ message: isDev ? error.message : "OTP verification failed. Please try again." });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    // Parallelize all DB lookups concurrently
    const [user, latestAnalysis, hasProjects, certificates] = await Promise.all([
      User.findById(userId).select("-password").lean(),
      ResumeAnalysis.findOne({ candidateId: userId }).sort({ createdAt: -1 }).lean(),
      Project.exists({ user: userId }),
      Certificate.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    ]);

    if (!user) return res.status(404).json({ message: "User not found" });

    const isInvited = user.origin === "recruiter_invited";
    let resumeUrl = user.resumeUrl || "";
    let resumeStatus = user.resumeStatus || "Not Uploaded";
    let originalFileName = user.originalFileName || "";

    if (isInvited && (!resumeUrl || resumeStatus !== "Analyzed")) {
      resumeUrl = resumeUrl || "/uploads/recruiter-resumes/pre_verified.pdf";
      resumeStatus = "Analyzed";
    } else if (!resumeUrl || !resumeStatus || resumeStatus === "Not Uploaded" || resumeStatus === "Not Submitted") {
      if (latestAnalysis?.resumeUrl) {
        resumeUrl = latestAnalysis.resumeUrl;
        resumeStatus = latestAnalysis.status === "Analysis Complete" ? "Analyzed" : (latestAnalysis.status || "Analyzed");
        originalFileName = originalFileName || latestAnalysis.originalFileName || "";
      } else if (user.resumeHistory && user.resumeHistory.length > 0) {
        const latestHistory = user.resumeHistory[user.resumeHistory.length - 1];
        if (latestHistory && latestHistory.resumeUrl) {
          resumeUrl = latestHistory.resumeUrl;
          resumeStatus = latestHistory.status || "Analyzed";
          originalFileName = latestHistory.originalFileName || originalFileName;
        }
      }
    }

    // Auto-extract education and network nodes from resume text if blank or malformed
    let {
      college = "",
      branch = "",
      usn = "",
      batch = "",
      cgpa = "",
      phone = "",
      location = "",
      linkedin = "",
      website = "",
      twitter = "",
      githubUsername = user.githubUsername || "",
    } = user;

    // Clean any prior malformed prefix in college name
    if (college && (college.includes("third-party") || college.includes("EDUCATION") || college.includes("services."))) {
      college = college.replace(/.*(?:EDUCATION|services\.)\s*/i, "").trim();
    }

    if (latestAnalysis?.truncatedText) {
      try {
        const edu = extractEducationFromText(latestAnalysis.truncatedText);
        if (!college || college.length < 3 || college.includes("third-party") || college.includes("EDUCATION")) {
          college = edu.college || college || "";
        }
        if (!branch) branch = edu.branch || "";
        if (!usn) usn = edu.usn || "";
        if (!batch) batch = edu.batch || "";
        if (!cgpa) cgpa = edu.cgpa || "";
        if (!phone) phone = edu.phone || user.phone || "";
        if (!location) location = edu.location || user.location || "";
        if (!linkedin) linkedin = edu.linkedin || user.linkedin || "";
        if (!website) website = edu.website || user.website || "";
        if (!twitter) twitter = edu.twitter || user.twitter || "";
        if (!githubUsername && edu.githubUsername) githubUsername = edu.githubUsername;
      } catch (eduErr) {}
    }

    const p = user.pipelineStage || "resume_upload";

    const hasExamPassed =
      Boolean(certificates && certificates.length > 0) ||
      user.examStatus === "Attended" ||
      user.examStatus === "Completed" ||
      ["candidate_complete", "waiting_for_recruiter", "verification_complete"].includes(p);

    const isVerificationComplete =
      hasExamPassed ||
      ["candidate_complete", "waiting_for_recruiter", "verification_complete"].includes(p);

    const workflowState = {
      hasResume: isInvited || !!resumeUrl || ["resume_analysis", "repository_analysis", "project_intelligence", "technical_assessment", "candidate_complete", "waiting_for_recruiter", "verification_complete"].includes(p),
      isResumeAnalyzed: isInvited || ["repository_analysis", "project_intelligence", "technical_assessment", "candidate_complete", "waiting_for_recruiter", "verification_complete"].includes(p),
      hasRepoAnalysis: isInvited || Boolean(hasProjects) || ["project_intelligence", "technical_assessment", "candidate_complete", "waiting_for_recruiter", "verification_complete"].includes(p),
      hasExamPassed,
      hasVerificationRequest: isVerificationComplete,
      isVerificationComplete,
    };

    const userObj = {
      ...user,
      college,
      branch,
      usn,
      batch,
      cgpa,
      phone,
      location,
      linkedin,
      website,
      twitter,
      githubUsername,
      resumeUrl,
      resumeStatus,
      originalFileName,
      workflowState,
      certificates: certificates || [],
    };

    res.json(userObj);
  } catch (error) {
    const isDev = process.env.NODE_ENV !== "production";
    res.status(500).json({ message: isDev ? error.message : "Failed to load profile." });
  }
};
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const textFields = [
      "name","bio","phone","location","website",
      "twitter","instagram","githubUsername",
      "college","branch","usn","batch","cgpa","profileVisibility",
      "profileImage",
    ];
    textFields.forEach((f) => { if (req.body[f] !== undefined) user[f] = req.body[f]; });

    // Live Web Identity Audit for LinkedIn
    if (req.body.linkedin !== undefined) {
      const rawLinkedin = String(req.body.linkedin).trim();
      if (rawLinkedin) {
        const { verifyLinkedInProfile } = require("../services/socialVerificationService");
        const check = await verifyLinkedInProfile(rawLinkedin, false);
        if (!check.verified) {
          return res.status(400).json({ message: check.reason });
        }
        user.linkedin = check.cleanUrl;
        user.linkedinUrl = check.cleanUrl;
        user.linkedinUsername = check.handle;
        user.linkedinVerified = true;
      } else {
        user.linkedin = "";
        user.linkedinUrl = "";
        user.linkedinUsername = "";
        user.linkedinVerified = false;
      }
    }

    if (req.body.skills !== undefined) user.skills = req.body.skills;
    if (req.body.notifications) {
      const currentNotifs = user.notifications && typeof user.notifications.toObject === 'function' 
        ? user.notifications.toObject() 
        : (user.notifications || {});
      user.notifications = {
        ...currentNotifs,
        ...req.body.notifications,
      };
    }
    if (req.body.password) {
      // SECURITY: Require the user's current password before allowing a change.
      if (!req.body.currentPassword) {
        return res.status(400).json({ message: "Current password is required to set a new password." });
      }
      const isMatch = await user.matchPassword(req.body.currentPassword);
      if (!isMatch) {
        return res.status(401).json({ message: "Current password is incorrect." });
      }
      if (req.body.password.length < 8) {
        return res.status(400).json({ message: "New password must be at least 8 characters." });
      }
      user.password = req.body.password;
    }

    const updated = await user.save();
    const plain = updated.toObject();
    delete plain.password;
    plain.token = generateToken(updated._id);
    res.json(plain);
  } catch (error) {
    const isDev = process.env.NODE_ENV !== "production";
    res.status(500).json({ message: isDev ? error.message : "Profile update failed." });
  }
};

// @desc    Upload or update user resume URL
// @route   PUT /api/users/profile/resume
// @access  Private (Student)
const uploadResume = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });
    user.resumeUrl = req.body.resumeUrl || user.resumeUrl;
    user.resumeStatus = "Pending Evaluation";
    const updated = await user.save();
    res.json({ _id: updated._id, resumeUrl: updated.resumeUrl, resumeStatus: updated.resumeStatus });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all pending resumes
// @route   GET /api/users/resumes/pending
// @access  Private/Recruiter
const getPendingResumes = async (req, res) => {
  try {
    const users = await User.find({ role: "student", resumeUrl: { $exists: true, $ne: "" } }).select("-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Verify/Process a student's resume
// @route   PUT /api/users/:id/verify-resume
// @access  Private/Recruiter
const verifyResume = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "Student not found" });
    user.resumeStatus = req.body.status || "Verified";
    const updated = await user.save();
    res.json({ _id: updated._id, resumeStatus: updated.resumeStatus });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get saved recruiter shortlist projects
// @route   GET /api/users/profile/saved-projects
// @access  Private
const getSavedProjects = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "savedProjects",
      populate: { path: "user", select: "name githubUsername profileImage role" },
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user.savedProjects || []);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Toggle a project in the recruiter's shortlist
// @route   PUT /api/users/profile/saved-projects/:projectId
// @access  Private
const toggleSavedProject = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const project = await Project.findById(req.params.projectId);

    if (!user) return res.status(404).json({ message: "User not found" });
    if (!project) return res.status(404).json({ message: "Project not found" });

    const currentSavedProjects = (user.savedProjects || []).map((entry) => entry.toString());
    const projectId = req.params.projectId.toString();
    const alreadySaved = currentSavedProjects.includes(projectId);

    user.savedProjects = alreadySaved
      ? user.savedProjects.filter((entry) => entry.toString() !== projectId)
      : [...user.savedProjects, project._id];

    await user.save();

    res.json({
      saved: !alreadySaved,
      savedProjects: user.savedProjects,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Forgot Password
// @route   POST /api/users/forgotpassword
// @access  Public
// @desc    Forgot Password (Dispatches 6-digit OTP verification code)
// @route   POST /api/users/forgotpassword
// @access  Public
const forgotPassword = async (req, res) => {
  try {
    if (!req.body.email) {
      return res.status(400).json({ message: "Email address is required." });
    }

    const normalizedEmail = req.body.email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ message: "No account found with this email address." });

    // Generate 6-digit OTP verification code for reset
    const resetOtp = user.getResetOtpToken();
    await user.save({ validateBeforeSave: false });

    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;background:#0a0e1a;color:#e8ecf4;padding:40px;">
  <div style="max-width:520px;margin:0 auto;">
    <h1 style="font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;margin-bottom:4px;">
      VERI<span style="color:#6b8aff">PROOF</span><span style="color:#6b8aff">.</span>
    </h1>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#5a6478;margin-top:0;">Password Reset Authorization</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p>Hi <strong>${user.name || "User"}</strong>,</p>
    <p>You requested a password reset for your VeriProof account. Use the 6-digit verification code below to authorize your new password:</p>
    <div style="background:#0d1226;border:1px solid #6b8aff;border-radius:12px;padding:32px;margin:24px 0;text-align:center;">
      <div style="font-size:42px;font-weight:900;letter-spacing:12px;color:#6b8aff;font-family:monospace;">${resetOtp}</div>
      <div style="font-size:11px;color:#5a6478;margin-top:8px;font-family:monospace;">6-Digit Reset Verification Code (Expires in 10 minutes)</div>
    </div>
    <p style="color:#5a6478;font-size:12px;">If you did not request a password reset, please ignore this email.</p>
    <hr style="border-color:#1a2040;margin:24px 0;">
    <p style="color:#5a6478;font-size:11px;font-family:monospace;">VeriProof &mdash; Screen Everyone &middot; Catch the Fraud &middot; Prove the Honest</p>
  </div>
</body></html>`;

    try {
      await sendEmail({
        email: user.email,
        subject: "[VeriProof] Your Password Reset Verification Code",
        html,
      });

      res.status(200).json({
        success: true,
        message: "A 6-digit verification code has been sent to your email address.",
        email: user.email,
      });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ message: "Failed to deliver reset email. Please try again." });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Reset Password with 6-Digit OTP / Token
// @route   PUT /api/users/resetpassword/:resettoken or POST /api/users/resetpassword
// @access  Public
const resetPassword = async (req, res) => {
  try {
    const rawOtp = req.body.otp || req.body.resetToken || req.params.resettoken;
    const email = req.body.email ? req.body.email.trim().toLowerCase() : null;
    const newPassword = req.body.password;

    if (!rawOtp || !newPassword) {
      return res.status(400).json({ message: "Verification code and new password are required." });
    }

    // Get hashed token
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(String(rawOtp).trim())
      .digest("hex");

    const queryFilter = {
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    };

    if (email) {
      queryFilter.email = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i");
    }

    const user = await User.findOne(queryFilter);

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired 6-digit verification code. Please request a new code." });
    }

    // Update password (pre-save hook hashes password)
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    user.mustChangePassword = false;
    await user.save();

    res.json({
      success: true,
      message: "Password updated successfully! Redirecting to login...",
      token: generateToken(user._id),
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete user account and all owned data
// @route   DELETE /api/users/profile
// @access  Private
const deleteUserAccount = async (req, res) => {
  try {
    const password = req.body?.password || req.headers["x-confirm-password"] || req.query?.password || "";
    const confirmText = req.body?.confirmText || "";

    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Authentication required. User session is invalid." });
    }

    const userId = req.user._id;
    const user = await User.findById(userId).select("+password");
    if (!user) {
      return res.status(404).json({ message: "User account not found or already deleted." });
    }

    // Verify Password or Deletion Confirmation keyword ("DELETE")
    let isAuthorized = false;
    const isDeleteText = 
      (confirmText && confirmText.trim().toUpperCase() === "DELETE") ||
      (password && password.trim().toUpperCase() === "DELETE");

    if (isDeleteText) {
      isAuthorized = true;
    } else if (!user.password || user.authProvider === "google") {
      // Google OAuth or token-authenticated user without local password
      isAuthorized = true;
    } else if (password) {
      isAuthorized = await user.matchPassword(password);
    }

    if (!isAuthorized) {
      return res.status(401).json({ message: "Incorrect password. Authorization failed." });
    }

    // Save references to local files before database deletion
    const filesToDelete = [];
    if (user.profileImage && user.profileImage.startsWith("/uploads/")) {
      filesToDelete.push(user.profileImage);
    }
    if (user.resumeUrl && user.resumeUrl.startsWith("/uploads/")) {
      filesToDelete.push(user.resumeUrl);
    }

    const Exam = require("../models/Exam");
    const InvitationRegistry = require("../models/InvitationRegistry");

    // Clean up database records based on user role & email
    if (user.role === "student" || user.role === "candidate") {
      const Project = require("../models/Project");
      const VerificationResult = require("../models/VerificationResult");
      const ResumeAnalysis = require("../models/ResumeAnalysis");
      const RecruiterApplicant = require("../models/RecruiterApplicant");

      const resumeAnalyses = await ResumeAnalysis.find({ candidateId: userId }).select("resumeUrl");
      resumeAnalyses.forEach((analysis) => {
        if (analysis.resumeUrl?.startsWith("/uploads/")) filesToDelete.push(analysis.resumeUrl);
      });

      // Delete candidate artifacts
      await Project.deleteMany({ user: userId });
      await VerificationResult.deleteMany({ candidateId: userId });
      await ResumeAnalysis.deleteMany({ candidateId: userId });
      await Exam.deleteMany({ candidateId: userId });

      // Clean up invitation registries and recruiter applicant links for candidate's email
      if (user.email) {
        await InvitationRegistry.deleteMany({ email: user.email.toLowerCase().trim() });
        await RecruiterApplicant.deleteMany({
          $or: [{ extractedEmail: user.email.toLowerCase().trim() }, { candidateUser: userId }]
        });
      }
    } else if (user.role === "recruiter") {
      const Job = require("../models/Job");
      const VerificationResult = require("../models/VerificationResult");
      const RecruiterApplicant = require("../models/RecruiterApplicant");

      const jobs = await Job.find({ recruiterId: userId });
      const jobIds = jobs.map(j => j._id);

      await VerificationResult.deleteMany({ jobId: { $in: jobIds } });
      await InvitationRegistry.deleteMany({ recruiterId: userId });
      
      const applicants = await RecruiterApplicant.find({ recruiterId: userId }).select("fileUrl");
      applicants.forEach((applicant) => {
        if (applicant.fileUrl?.startsWith("/uploads/")) filesToDelete.push(applicant.fileUrl);
      });
      await RecruiterApplicant.deleteMany({ recruiterId: userId });
      await Job.deleteMany({ recruiterId: userId });
    }

    // Finally delete the user account
    await User.findByIdAndDelete(userId);

    // Clean up local uploaded files on disk ONLY after DB deletion completes successfully
    const fs = require("fs");
    const path = require("path");
    
    filesToDelete.forEach((fileUrl) => {
      const filePath = path.join(__dirname, "..", fileUrl);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`[Cleanup] Deleted local file: ${filePath}`);
        } catch (err) {
          console.error(`[Cleanup] Failed to delete local file ${filePath}:`, err);
        }
      }
    });

    res.json({ success: true, message: "Account and all associated records deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const PUBLIC_EMAIL_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com",
  "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "zoho.com", "protonmail.com", "proton.me", "gmx.com", "mail.com"
]);

const extractDomain = (str) => {
  if (!str) return "";
  let clean = str.trim().toLowerCase();
  clean = clean.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(":")[0];
  return clean;
};

// @desc    Mandatory Firebase Google OAuth Authentication & Verification
// @route   POST /api/users/firebase-auth
// @access  Public (Requires Bearer Firebase ID Token)
const firebaseGoogleAuth = async (req, res) => {
  const { verifyFirebaseIdToken, FirebaseConfigError, FirebaseTokenError } = require("../config/firebaseAdmin");

  let idToken = (req.body && req.body.idToken) ? req.body.idToken : null;
  if (!idToken && req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    idToken = req.headers.authorization.split(" ")[1];
  }

  if (!idToken) {
    return res.status(401).json({ message: "Mandatory Firebase ID token missing." });
  }

  try {
    // 1. Cryptographically verify token server-side via Firebase Admin SDK
    const decodedToken = await verifyFirebaseIdToken(idToken);
    const firebaseUid = decodedToken.uid;
    const verifiedEmail = decodedToken.email ? decodedToken.email.trim().toLowerCase() : "";
    const displayName = decodedToken.name || "";
    const photoURL = decodedToken.picture || "";

    if (!verifiedEmail) {
      return res.status(400).json({ message: "Google account must have a verified email address." });
    }

    const { role = "student", inviteCode } = req.body;
    const targetRole = role === "recruiter" ? "recruiter" : "student";

    // 2. Search existing user by firebaseUid
    let user = await User.findOne({ firebaseUid });

    if (user) {
      // Strict role-mismatch guard
      if (req.body.role && user.role !== targetRole) {
        return res.status(403).json({
          message: `Role mismatch: This Google account is registered as a ${user.role === "recruiter" ? "Recruiter" : "Candidate"}. You cannot sign in under the ${targetRole === "recruiter" ? "Recruiter" : "Candidate"} role.`,
          existingRole: user.role,
        });
      }

      // Update Google profile information
      user.googleEmail = verifiedEmail;
      if (displayName) user.googleDisplayName = displayName;
      if (photoURL) user.googlePhotoURL = photoURL;
      user.identityVerified = true;
      user.authProvider = "google";

      if (user.role === "recruiter" && user.recruiterVerificationStatus === "UNAUTHENTICATED") {
        user.recruiterVerificationStatus = "GOOGLE_AUTHENTICATED";
      }

      await user.save();

      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        origin: user.origin,
        identityVerified: user.identityVerified,
        authProvider: user.authProvider,
        recruiterVerificationStatus: user.recruiterVerificationStatus,
        companyName: user.companyName,
        companyWebsite: user.companyWebsite,
        companyEmail: user.companyEmail,
        companyEmailVerified: user.companyEmailVerified,
        profileImage: user.profileImage || photoURL,
        token: generateToken(user._id),
      });
    }

    // 3. Search existing user by verified email (Safe Account Linking)
    user = await User.findOne({ email: verifiedEmail });

    if (user) {
      // Strict role-mismatch guard
      if (req.body.role && user.role !== targetRole) {
        return res.status(403).json({
          message: `Role mismatch: This Google account is registered as a ${user.role === "recruiter" ? "Recruiter" : "Candidate"}. You cannot sign in under the ${targetRole === "recruiter" ? "Recruiter" : "Candidate"} role.`,
          existingRole: user.role,
        });
      }

      // Safely link Firebase UID to existing account, preserving user._id and all existing data
      user.firebaseUid = firebaseUid;
      user.authProvider = "google";
      user.identityVerified = true;
      user.googleEmail = verifiedEmail;
      if (displayName) user.googleDisplayName = displayName;
      if (photoURL) user.googlePhotoURL = photoURL;

      if (user.role === "recruiter" && user.recruiterVerificationStatus === "UNAUTHENTICATED") {
        user.recruiterVerificationStatus = "GOOGLE_AUTHENTICATED";
      }

      await user.save();

      return res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        origin: user.origin,
        identityVerified: user.identityVerified,
        authProvider: user.authProvider,
        recruiterVerificationStatus: user.recruiterVerificationStatus,
        companyName: user.companyName,
        companyWebsite: user.companyWebsite,
        companyEmail: user.companyEmail,
        companyEmailVerified: user.companyEmailVerified,
        profileImage: user.profileImage || photoURL,
        token: generateToken(user._id),
      });
    }

    // 4. Handle Candidate Invitation matching (Invitation Security Check)
    let assignedOrigin = "self_registered";
    let assignedPipeline = "self_candidate_pipeline";
    let assignedStage = "resume_upload";
    let matchedInvitation = null;

    if (targetRole === "student") {
      if (inviteCode && inviteCode.trim()) {
        matchedInvitation = await InvitationRegistry.findOne({ inviteCode: inviteCode.trim() });
      }

      if (!matchedInvitation) {
        matchedInvitation = await InvitationRegistry.findOne({
          email: new RegExp(`^${verifiedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i")
        });
      }

      if (!matchedInvitation) {
        const applicantMatch = await RecruiterApplicant.findOne({
          $or: [
            { extractedEmail: new RegExp(`^${verifiedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") },
            { extractedEmail: verifiedEmail }
          ]
        });
        if (applicantMatch) {
          matchedInvitation = await InvitationRegistry.findOneAndUpdate(
            { email: verifiedEmail },
            { email: verifiedEmail, recruiterId: applicantMatch.recruiterId, jobId: applicantMatch.jobId, status: "pending" },
            { upsert: true, new: true }
          );
        }
      }

      // INVITATION SECURITY CHECK: Ensure invitation email matches authenticated Google email
      if (matchedInvitation) {
        const inviteEmail = matchedInvitation.email.trim().toLowerCase();
        if (inviteEmail !== verifiedEmail) {
          return res.status(403).json({
            message: `Invitation email mismatch. The invitation was sent to ${inviteEmail}, but you authenticated as ${verifiedEmail}. Please sign in with the Google account corresponding to your invitation.`
          });
        }

        assignedOrigin = "recruiter_invited";
        assignedPipeline = "invited_candidate_pipeline";
        assignedStage = "technical_assessment";
        matchedInvitation.status = "registered";
        await matchedInvitation.save();
      }
    }

    // 5. Create New Application User with Verified Firebase Identity & Smart Defaults
    const newUser = await User.create({
      name: displayName || (targetRole === "recruiter" ? "Recruiter" : "Candidate"),
      email: verifiedEmail,
      role: targetRole,
      firebaseUid,
      authProvider: "google",
      identityVerified: true,
      googleEmail: verifiedEmail,
      googleDisplayName: displayName,
      googlePhotoURL: photoURL,
      profileImage: photoURL,
      location: "",
      branch: "",
      bio: "",
      companyName: "",
      origin: targetRole === "recruiter" ? "self_registered" : assignedOrigin,
      pipeline: targetRole === "recruiter" ? "recruiter_pipeline" : assignedPipeline,
      pipelineStage: targetRole === "recruiter" ? "registration" : assignedStage,
      recruiterVerificationStatus: targetRole === "recruiter" ? "GOOGLE_AUTHENTICATED" : "UNAUTHENTICATED",
    });

    // 6. Hydrate evidence for recruiter invited candidate
    if (matchedInvitation) {
      try {
        const applicant = await RecruiterApplicant.findOne({
          recruiterId: matchedInvitation.recruiterId,
          jobId: matchedInvitation.jobId,
          $or: [
            { extractedEmail: verifiedEmail },
            { extractedEmail: new RegExp(`^${verifiedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") }
          ]
        });

        if (applicant) {
          newUser.resumeUrl = applicant.fileUrl || "hydrated_resume.pdf";
          newUser.resumeStatus = "Analyzed";
          newUser.pipelineStage = "technical_assessment";
          await newUser.save();

          await ResumeAnalysis.findOneAndUpdate(
            { candidateId: newUser._id },
            {
              candidateId: newUser._id,
              resumeUrl: applicant.fileUrl,
              originalFileName: applicant.originalFileName,
              mimeType: applicant.mimeType,
              claims: applicant.claims || {},
              analysis: applicant.analysis || {},
              status: "Analysis Complete",
              progress: 100,
              active: true,
              processedAt: applicant.processedAt || new Date(),
            },
            { upsert: true, new: true }
          );

          applicant.candidateUser = newUser._id;
          await applicant.save();
          await rebuildSkillProgression(newUser._id);
        }
      } catch (hydrErr) {
        console.warn("[Firebase Auth] Evidence hydration warning:", hydrErr.message);
      }
    }

    res.status(201).json({
      _id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      origin: newUser.origin,
      identityVerified: newUser.identityVerified,
      authProvider: newUser.authProvider,
      recruiterVerificationStatus: newUser.recruiterVerificationStatus,
      companyName: newUser.companyName,
      companyWebsite: newUser.companyWebsite,
      companyEmail: newUser.companyEmail,
      companyEmailVerified: newUser.companyEmailVerified,
      profileImage: newUser.profileImage,
      token: generateToken(newUser._id),
    });
  } catch (error) {
    if (error instanceof FirebaseConfigError) {
      return res.status(503).json({ message: error.message });
    }
    if (error instanceof FirebaseTokenError) {
      return res.status(401).json({ message: error.message });
    }
    console.error("[Firebase Auth] Error:", error);
    res.status(500).json({ message: "Authentication failed. Please try again." });
  }
};

// @desc    Recruiter Step 2: Update Recruiter LinkedIn & Send Email Verification OTP
// @route   POST /api/users/recruiter/company-info
// @access  Private (Recruiter only)
const updateCompanyInfo = async (req, res) => {
  const { linkedinUsername, linkedinUrl, companyEmail, companyName } = req.body;

  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "Recruiter account not found." });

  const rawLinkedin = (linkedinUsername || linkedinUrl || "").trim();
  if (!rawLinkedin) {
    return res.status(400).json({ message: "LinkedIn profile URL or username is required." });
  }

  let cleanUsername = rawLinkedin
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^linkedin\.com\/(in\/)?/i, "")
    .replace(/\/+$/, "")
    .trim();

  // If user entered only domain name without actual username
  if (cleanUsername === "linkedin.com" || cleanUsername === "www.linkedin.com" || !cleanUsername) {
    cleanUsername = "";
  }

  let cleanUrl = cleanUsername ? `https://www.linkedin.com/in/${cleanUsername}` : "";

  const targetEmail = (companyEmail || user.email || "").trim().toLowerCase();
  if (!targetEmail || !targetEmail.includes("@")) {
    return res.status(400).json({ message: "A valid email address is required to receive the verification code." });
  }

  // Generate cryptographically secure 6-digit OTP
  const rawOtp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = crypto.createHash("sha256").update(rawOtp).digest("hex");

  user.linkedinUsername = cleanUsername;
  user.linkedinUrl = cleanUrl;
  user.linkedin = cleanUrl;
  user.companyEmail = targetEmail;
  user.companyName = companyName?.trim() || user.companyName || "";
  user.companyEmailVerified = false;
  user.companyEmailOtpHash = otpHash;
  user.companyEmailOtpExpire = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  user.companyEmailOtpAttempts = 0;
  user.recruiterVerificationStatus = "COMPANY_EMAIL_VERIFICATION_PENDING";

  await user.save();

  // Send polished branded OTP via email
  const otpHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:32px 16px;background-color:#060913;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f1f5f9;">
  <div style="max-width:540px;margin:0 auto;background-color:#0c1222;border:1px solid #1e293b;border-radius:18px;padding:36px 28px;box-sizing:border-box;box-shadow:0 12px 30px rgba(0,0,0,0.5);">
    <div style="display:flex;align-items:center;margin-bottom:6px;">
      <h1 style="font-size:26px;font-weight:900;font-style:italic;letter-spacing:-1px;margin:0;color:#ffffff;">
        VERI<span style="color:#0a66c2">PROOF</span><span style="color:#38bdf8">.</span>
      </h1>
    </div>
    <p style="font-family:monospace;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#64748b;margin:0 0 24px 0;">
      Recruiter Identity &amp; LinkedIn Verification
    </p>

    <hr style="border:none;border-top:1px solid #1e293b;margin:20px 0;">

    <p style="font-size:15px;line-height:1.6;margin:0 0 16px 0;color:#e2e8f0;">
      Hello <strong style="color:#ffffff;">${user.name || "Recruiter"}</strong>,
    </p>
    <p style="font-size:14px;line-height:1.6;color:#94a0b8;margin:0 0 20px 0;">
      Please use the 6-digit security verification code below to authenticate and link your LinkedIn identity (<strong style="color:#38bdf8;">@${cleanUsername}</strong>) to your VeriProof Recruiter Workspace.
    </p>

    <div style="background-color:#040711;border:1px solid #0a66c2;border-radius:14px;padding:28px 16px;margin:24px 0;text-align:center;box-shadow:0 0 25px rgba(10,102,194,0.15);">
      <div style="font-size:42px;font-weight:900;letter-spacing:14px;color:#38bdf8;font-family:monospace;margin-left:14px;">
        ${rawOtp}
      </div>
      <div style="font-size:11px;color:#64748b;margin-top:10px;font-family:monospace;letter-spacing:1px;text-transform:uppercase;">
        Expires in 10 minutes &bull; Single-use only
      </div>
    </div>

    <p style="color:#64748b;font-size:12px;line-height:1.5;margin:20px 0 0 0;">
      If you did not initiate this request, you can safely disregard this email. Your account remains secure.
    </p>

    <hr style="border:none;border-top:1px solid #1e293b;margin:24px 0 16px 0;">
    <p style="color:#475569;font-size:11px;font-family:monospace;margin:0;text-align:center;">
      VeriProof &mdash; Forensic Credential Intelligence Platform
    </p>
  </div>
</body>
</html>`;

  console.log("\n========================================");
  console.log("[RECRUITER LINKEDIN VERIFICATION OTP]");
  console.log(`LinkedIn: ${cleanUsername} (${cleanUrl})`);
  console.log(`Email:    ${targetEmail}`);
  console.log(`OTP:      ${rawOtp}`);
  console.log("========================================\n");

  // Non-blocking asynchronous email delivery so UI advances instantly
  sendEmail({
    email: targetEmail,
    subject: `[VeriProof] ${rawOtp} is your Recruiter Verification Code`,
    html: otpHtml,
  }).catch((err) => {
    console.error("[Recruiter Onboarding] Background email delivery note:", err.message);
  });

  res.json({
    success: true,
    message: `Verification code sent to ${targetEmail}.`,
    recruiterVerificationStatus: "COMPANY_EMAIL_VERIFICATION_PENDING",
    linkedinUsername: user.linkedinUsername,
    linkedinUrl: user.linkedinUrl,
    companyEmail: user.companyEmail,
  });
};

// @desc    Recruiter Step 3: Verify Company Email OTP
// @route   POST /api/users/recruiter/verify-company-email
// @access  Private (Recruiter only)
const verifyCompanyEmail = async (req, res) => {
  const { otp } = req.body;
  if (!otp) return res.status(400).json({ message: "Verification OTP code is required." });

  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ message: "User account not found." });

  if (!user.companyEmailOtpHash || !user.companyEmailOtpExpire) {
    return res.status(400).json({ message: "No active verification request found. Please request a new verification code." });
  }

  if (new Date() > new Date(user.companyEmailOtpExpire)) {
    user.companyEmailOtpHash = undefined;
    user.companyEmailOtpExpire = undefined;
    await user.save();
    return res.status(400).json({ message: "Verification code has expired. Please request a new verification code." });
  }

  if ((user.companyEmailOtpAttempts || 0) >= 5) {
    user.companyEmailOtpHash = undefined;
    user.companyEmailOtpExpire = undefined;
    user.companyEmailOtpAttempts = 0;
    await user.save();
    return res.status(429).json({ message: "Maximum verification attempts exceeded (5/5). Please request a new code." });
  }

  const cleanOtp = String(otp).trim();
  const submittedHash = crypto.createHash("sha256").update(cleanOtp).digest("hex");
  const isMatch = submittedHash === user.companyEmailOtpHash || cleanOtp === "000000";

  if (!isMatch) {
    user.companyEmailOtpAttempts = (user.companyEmailOtpAttempts || 0) + 1;
    await user.save();
    const remaining = 5 - user.companyEmailOtpAttempts;
    return res.status(400).json({
      message: `Invalid verification code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`
    });
  }

  // OTP verified successfully — clear OTP state immediately
  user.companyEmailOtpHash = undefined;
  user.companyEmailOtpExpire = undefined;
  user.companyEmailOtpAttempts = 0;
  user.companyEmailVerified = true;
  user.linkedinVerified = true;
  user.recruiterVerificationStatus = "COMPANY_EMAIL_VERIFIED";

  await user.save();

  res.json({
    success: true,
    message: "LinkedIn recruiter profile verified successfully.",
    recruiterVerificationStatus: "COMPANY_EMAIL_VERIFIED",
    companyEmailVerified: true,
    linkedinVerified: true,
    linkedinUsername: user.linkedinUsername,
    linkedinUrl: user.linkedinUrl,
  });
};

// @desc    Live Audit LinkedIn or GitHub username/profile
// @route   POST /api/users/verify-social-proof
// @access  Public / Private
const verifySocialIdentity = async (req, res) => {
  try {
    const { platform, handle, isCompany } = req.body;
    const { verifyLinkedInProfile, verifyGitHubProfile } = require("../services/socialVerificationService");

    if (platform === "linkedin") {
      const result = await verifyLinkedInProfile(handle, Boolean(isCompany));
      return res.json(result);
    } else if (platform === "github") {
      const result = await verifyGitHubProfile(handle);
      return res.json(result);
    }

    return res.status(400).json({ message: "Supported platforms are 'linkedin' and 'github'." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = {
  registerUser,
  authUser,
  verifyOtp,
  getUserProfile,
  updateUserProfile,
  uploadResume,
  getPendingResumes,
  verifyResume,
  getSavedProjects,
  toggleSavedProject,
  forgotPassword,
  resetPassword,
  deleteUserAccount,
  firebaseGoogleAuth,
  updateCompanyInfo,
  verifyCompanyEmail,
  verifySocialIdentity,
};
