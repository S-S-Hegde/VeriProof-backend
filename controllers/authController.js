const User = require("../models/User");
const Project = require("../models/Project");
const generateToken = require("../utils/generateToken");
const crypto = require("crypto");
const sendEmail = require("../utils/sendEmail");

// @desc    Register a new user
// @route   POST /api/users
// @access  Public
const registerUser = async (req, res) => {
  const { name, email, password, role, githubUsername } = req.body;
  try {
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: "User already exists" });

    const user = await User.create({ name, email, password, role: role || "student", githubUsername });
    if (user) {
      res.status(201).json({
        _id: user._id, name: user.name, email: user.email,
        role: user.role, githubUsername: user.githubUsername,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Auth user & get token
// @route   POST /api/users/login
// @access  Public
const authUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id, name: user.name, email: user.email,
        role: user.role, githubUsername: user.githubUsername,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: "Invalid email or password" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update full user profile (name, bio, social, academic, prefs)
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const textFields = [
      "name","bio","phone","location","website",
      "linkedin","twitter","instagram","githubUsername",
      "college","branch","usn","batch","cgpa","profileVisibility",
    ];
    textFields.forEach((f) => { if (req.body[f] !== undefined) user[f] = req.body[f]; });
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
    if (req.body.password && req.body.password.length >= 6) {
      user.password = req.body.password;
    }

    const updated = await user.save();
    const plain = updated.toObject();
    delete plain.password;
    plain.token = generateToken(updated._id);
    res.json(plain);
  } catch (error) {
    res.status(500).json({ message: error.message });
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
const forgotPassword = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) return res.status(404).json({ message: "There is no user with that email" });

    // Get reset token
    const resetToken = user.getResetPasswordToken();
    await user.save({ validateBeforeSave: false });

    // Create reset url
    const frontendUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host").replace('5000', '5173')}`;
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please click the link below to reset your password: \n\n ${resetUrl}`;

    try {
      await sendEmail({
        email: user.email,
        subject: "Password Reset Token",
        message,
      });

      res.status(200).json({ message: "Email sent" });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ message: "Email could not be sent" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Reset Password
// @route   PUT /api/users/resetpassword/:resettoken
// @access  Public
const resetPassword = async (req, res) => {
  try {
    // Get hashed token
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(req.params.resettoken)
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: "Invalid token" });

    // Set new password
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.json({ message: "Password updated successfully", token: generateToken(user._id) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  registerUser,
  authUser,
  getUserProfile,
  updateUserProfile,
  uploadResume,
  getPendingResumes,
  verifyResume,
  getSavedProjects,
  toggleSavedProject,
  forgotPassword,
  resetPassword,
};
