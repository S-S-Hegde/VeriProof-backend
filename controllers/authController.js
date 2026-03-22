const User = require("../models/User");
const generateToken = require("../utils/generateToken");

// @desc    Register a new user
// @route   POST /api/users
// @access  Public
const registerUser = async (req, res) => {
  const { name, email, password, role, githubUsername } = req.body;

  try {
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || "student",
      githubUsername,
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        githubUsername: user.githubUsername,
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
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        githubUsername: user.githubUsername,
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
    const user = await User.findById(req.user._id);

    if (user) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        githubUsername: user.githubUsername,
        skills: user.skills,
        profileImage: user.profileImage,
      });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Upload or update user resume
// @route   PUT /api/users/profile/resume
// @access  Private (Student)
const uploadResume = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      user.resumeUrl = req.body.resumeUrl || user.resumeUrl;
      user.resumeStatus = "Pending Evaluation"; // Reset status on new upload

      const updatedUser = await user.save();
      res.json({
        _id: updatedUser._id,
        resumeUrl: updatedUser.resumeUrl,
        resumeStatus: updatedUser.resumeStatus,
      });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all pending resumes
// @route   GET /api/users/resumes/pending
// @access  Private/Recruiter
const getPendingResumes = async (req, res) => {
  try {
    const users = await User.find({
      role: "student",
      resumeUrl: { $exists: true, $ne: "" },
    }).select("-password");

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

    if (user) {
      user.resumeStatus = req.body.status || "Verified";
      const updatedUser = await user.save();
      
      res.json({
        _id: updatedUser._id,
        resumeStatus: updatedUser.resumeStatus,
      });
    } else {
      res.status(404).json({ message: "Student not found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  registerUser,
  authUser,
  getUserProfile,
  uploadResume,
  getPendingResumes,
  verifyResume,
};
