const express = require("express");
const { scoreResume } = require("../lib/scoreResume");

const router = express.Router();

// POST /score-resume  { resumeText, jobTitle, jobDescription }
// Kept for compatibility with ApplicationsView.jsx's request/response shape
// (score, matchedSkills, missingSkills, summary). Scoring now normally
// happens automatically inside /apply/:jobId; this route lets a recruiter
// re-score manually if needed.
router.post("/score-resume", async (req, res) => {
  const { resumeText, jobTitle, jobDescription } = req.body || {};

  if (typeof resumeText !== "string" || !resumeText.trim()) {
    return res.status(400).json({ error: "resumeText is required." });
  }

  const result = await scoreResume({ resumeText, jobTitle, jobDescription });
  return res.status(200).json(result);
});

module.exports = router;
