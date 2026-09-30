const fs = require('fs');

// 1. Add recordAuditSnapshot to examController.js
let controller = fs.readFileSync('controllers/examController.js', 'utf8');

const newCode = `
// @desc    Record periodic face audit snapshot to Cloudinary
// @route   POST /api/exams/:examId/proctor/snapshot
// @access  Private
const recordAuditSnapshot = async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    const { examId } = req.params;

    if (!imageBase64) return res.status(400).json({ message: "No image provided" });
    if (!req.user || !req.user._id) return res.status(401).json({ message: "Unauthorized" });

    const Exam = require("../models/Exam");
    const activeExam = await Exam.findOne({ _id: examId, candidateId: req.user._id });
    if (!activeExam) return res.status(404).json({ message: "Exam not found" });

    const cloudinary = require("../utils/cloudinary");
    const uploadResult = await cloudinary.uploader.upload(imageBase64, {
      folder: \`veriproof/audits/\${examId}\`,
      resource_type: "image"
    });

    if (!Array.isArray(activeExam.snapshots)) activeExam.snapshots = [];
    activeExam.snapshots.push({
      url: uploadResult.secure_url,
      timestamp: new Date()
    });
    
    await activeExam.save();
    return res.status(200).json({ success: true, url: uploadResult.secure_url });
  } catch (error) {
    console.error("[recordAuditSnapshot Error]", error);
    return res.status(500).json({ success: false, message: "Snapshot recording failed" });
  }
};
`;

controller = controller.replace('module.exports = {', newCode + '\nmodule.exports = {');
controller = controller.replace('module.exports = {', 'module.exports = {\n  recordAuditSnapshot,');
fs.writeFileSync('controllers/examController.js', controller);

// 2. Add route to examRoutes.js
let routes = fs.readFileSync('routes/examRoutes.js', 'utf8');
routes = routes.replace('recordProctorViolation,', 'recordProctorViolation,\n  recordAuditSnapshot,');
routes = routes.replace('router.post("/record-violation", protect, recordProctorViolation);', 'router.post("/record-violation", protect, recordProctorViolation);\nrouter.post("/:examId/proctor/snapshot", protect, recordAuditSnapshot);');
fs.writeFileSync('routes/examRoutes.js', routes);

console.log('Done modifying backend files.');
