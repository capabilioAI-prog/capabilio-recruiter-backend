const express = require("express");
const { askClaudeForJson } = require("../lib/anthropic");
const { sendEmail } = require("../lib/email");

const router = express.Router();

// POST /generate-feedback
// { candidateName, jobTitle, score, missingSkills, atsSummary, strengths }
// -> { feedback: "<email body text>" }
router.post("/generate-feedback", async (req, res) => {
  const {
    candidateName,
    jobTitle,
    score,
    missingSkills = [],
    atsSummary = "",
    strengths = [],
  } = req.body || {};

  if (!candidateName || !jobTitle) {
    return res.status(400).json({ error: "candidateName and jobTitle are required." });
  }

  const system = `You write warm, honest, encouraging candidate rejection feedback emails for a \
recruiting platform. Tone: respectful, specific, constructive -- never generic corporate boilerplate. \
Respond with ONLY a JSON object, no markdown fences: {"feedback": "<full email body text, including a greeting and sign-off>"}`;

  const prompt = `Candidate: ${candidateName}
Role applied for: ${jobTitle}
ATS score: ${typeof score === "number" ? score : "not scored"}/100
ATS summary: ${atsSummary || "none"}
Strengths observed: ${(strengths || []).join(", ") || "none noted"}
Missing/gap skills: ${(missingSkills || []).join(", ") || "none noted"}

Write the rejection feedback email now.`;

  try {
    const result = await askClaudeForJson({ system, prompt, maxTokens: 700 });
    const feedback = typeof result.feedback === "string" ? result.feedback : "";
    if (!feedback.trim()) throw new Error("empty feedback from model");
    return res.status(200).json({ feedback });
  } catch (err) {
    console.error("generate-feedback: Claude call failed:", err.message);
    // Frontend already has a local fallback template if this route errors,
    // but returning 200 with a safe generic fallback is friendlier than a
    // 500 that the recruiter has to notice and retry.
    const missing = (missingSkills || []).slice(0, 3);
    const strong = (strengths || []).slice(0, 2);
    const fallback = `Hi ${candidateName},

Thank you for applying for the ${jobTitle} position. We appreciated the time you took.

After careful review, we've decided to move forward with other candidates whose experience more closely matches our current needs.
${strong.length ? `\nWhat stood out: ${strong.join(", ")}.` : ""}
${missing.length ? `\nAreas that would strengthen a future application: ${missing.join(", ")}.` : ""}

We wish you the best in your search.

With respect,
The Hiring Team`;
    return res.status(200).json({ feedback: fallback });
  }
});

// POST /send-feedback
// { candidateEmail, candidateName, feedback }
router.post("/send-feedback", async (req, res) => {
  const { candidateEmail, candidateName, feedback } = req.body || {};

  if (!candidateEmail || !feedback) {
    return res.status(400).json({ error: "candidateEmail and feedback are required." });
  }

  try {
    await sendEmail({
      to: candidateEmail,
      subject: "Update on your application",
      text: feedback,
    });
    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error(`send-feedback: failed for ${candidateEmail}:`, err.message);
    return res.status(502).json({ sent: false, error: "Email delivery failed." });
  }
});

module.exports = router;
