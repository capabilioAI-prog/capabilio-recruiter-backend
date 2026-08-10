const multer = require("multer");

// Multi-file variant of middleware/upload.js's single-resume config, for the
// recruiter-side bulk resume screener (POST /resume-screening/bulk-parse).
// Same per-file constraints (PDF only, 5MB cap) as the public apply flow --
// just a higher file count since a recruiter uploads a batch at once, not
// one candidate's own resume. 15 is a deliberate ceiling: each file costs a
// pdf-parse pass plus two Claude calls (scoreResume + extractResumeIdentity)
// processed sequentially in the route, so this also bounds worst-case
// request latency to something a browser request will actually wait out.
const uploadMulti = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 15 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF resumes are accepted."));
    }
    cb(null, true);
  },
});

module.exports = { uploadMulti };
