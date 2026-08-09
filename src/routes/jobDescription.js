// Job description AI draft — 2026-08-09
// ---------------------------------------------------------------------------
// FIXES: JobBoard.jsx's "Generate Description with AI" button in the Create
// Job modal called https://api.anthropic.com/v1/messages DIRECTLY FROM THE
// BROWSER with no Authorization header at all -- same class of bug already
// fixed in offers.js (generate-offer-letter) and feedback.js
// (generate-feedback). Every real call 401'd silently and the frontend's own
// catch block quietly returned a static template -- so "AI-generated" job
// descriptions were always the same hardcoded text, never real model output.
// This moves the call server-side, reusing the same askClaudeForJson pattern,
// with the SAME graceful-degradation behavior (200 + safe fallback on
// failure, never leave the recruiter stuck on an error).
const express = require("express");
const { askClaudeForJson } = require("../lib/anthropic");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function fallbackDescription(job) {
  return {
    description: `We are looking for a talented ${job.title} to join our team.`,
    responsibilities: ["Lead key projects", "Collaborate with team", "Drive results", "Mentor junior members", "Report to leadership"],
    requirements: ["Relevant experience", "Strong communication", "Team player", "Problem solver"],
    niceToHave: ["Leadership experience", "Domain certifications", "Open source contributions"],
  };
}

// POST /generate-job-description
// { title, domain, type, experience, skills, salary, location } ->
// { description, responsibilities: [...], requirements: [...], niceToHave: [...] }
router.post("/generate-job-description", requireAuth, async (req, res) => {
  const job = req.body || {};
  if (!job.title || !String(job.title).trim()) {
    return res.status(400).json({ error: "title is required." });
  }

  const system = `You write compelling, realistic job descriptions for a recruiting platform. \
Respond with ONLY a JSON object, no markdown fences: \
{"description":"<2-3 sentences>","responsibilities":["r1","r2","r3","r4","r5"],"requirements":["req1","req2","req3","req4"],"niceToHave":["n1","n2","n3"]}`;

  const prompt = `Title: ${job.title}
Domain: ${job.domain || "General"}
Type: ${job.type || "Full-time"}
Experience level: ${job.experience || "Mid"}
Skills: ${job.skills || "Not specified"}
Salary: ${job.salary || "Not specified"}
Location: ${job.location || "Remote"}

Write a compelling job description matching the fields above.`;

  try {
    const result = await askClaudeForJson({ system, prompt, maxTokens: 1000 });
    if (!result || typeof result.description !== "string" || !result.description.trim()) {
      throw new Error("empty/malformed description from model");
    }
    return res.status(200).json({
      description: result.description,
      responsibilities: Array.isArray(result.responsibilities) ? result.responsibilities : [],
      requirements: Array.isArray(result.requirements) ? result.requirements : [],
      niceToHave: Array.isArray(result.niceToHave) ? result.niceToHave : [],
    });
  } catch (err) {
    console.error("generate-job-description: Claude call failed:", err.message);
    return res.status(200).json(fallbackDescription(job));
  }
});

module.exports = router;
// Attached for unit testing only -- see the equivalent note in bulkReject.js.
module.exports.fallbackDescription = fallbackDescription;
