const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["student", "recruiter"],
      default: "student",
    },
    githubUsername: {
      type: String,
    },
    profileImage: {
      type: String,
    },
    skills: {
      type: [String],
    },
    resumeUrl: {
      type: String,
    },
    resumeStatus: {
      type: String,
      enum: ["Pending Evaluation", "Verified", "Rejected"],
      default: "Pending Evaluation",
    },
  },
  {
    timestamps: true,
  },
);

// Add fields to Schema (since it is already defined above, we can just replace the definition block)

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);
module.exports = User;
