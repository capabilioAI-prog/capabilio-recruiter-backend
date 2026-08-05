const multer = require("multer");

// Matches the frontend's own guard (ApplyPage.jsx checks file.size > 5MB and
// accept=".pdf,application/pdf") -- enforced again here since client-side
// checks are trivially bypassable.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF resumes are accepted."));
    }
    cb(null, true);
  },
});

module.exports = { upload };
