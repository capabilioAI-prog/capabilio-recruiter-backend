// AI message draft — 2026-08-09
// ---------------------------------------------------------------------------
// FIX: MessagingCenter.jsx's "✨ AI Draft" button previously called
// https://api.anthropic.com/v1/messages DIRECTLY FROM THE BROWSER with no
// Authorization/x-api-key header at all -- every real call 401'd silently
// (caught, swallowed, returned ""), so the button always did nothing with
// no error shown to the recruiter. Same broken-in-the-browser pattern
// already fixed in offers.js/feedback.js; this is the same fix applied
// here, using the same askClaudeForJson server-side pattern.
const express = require("express");
const { askClaudeForJson } = require("../lib/anthropic");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /message-draft  { candidateName, purpose }
// -> { draft: "<message body text>" }
router.post("/message-draft", requireAuth, async (req, res) => {
  const candidateName = String(req.body?.candidateName || "the candidate").slice(0, 120);
  const purpose = String(req.body?.purpose || "introduction").slice(0, 60);

  const system = `You write short, warm, professional recruiter outreach messages for a recruiting platform. \
Never salesy, never generic corporate boilerplate. Respond with ONLY a JSON object, no markdown fences: \
{"draft": "<message body text, using \\n for line breaks, no subject line>"}`;

  const prompt = `Candidate name: ${candidateName}
Purpose of this message: ${purpose}

Write a short, personalized outreach message now (3-5 sentences).`;

  try {
    const result = await askClaudeForJson({ system, prompt, maxTokens: 500 });
    const draft = typeof result.draft === "string" ? result.draft.trim() : "";
    if (!draft) throw new Error("empty draft from model");
    return res.status(200).json({ draft });
  } catch (err) {
    console.error("message-draft: Claude call failed:", err.message);
    // Unlike offers.js/feedback.js, there's no safe generic fallback text
    // worth pretending is a real draft here -- an empty response with a
    // clear error is more honest than a template disguised as a personal
    // outreach message. The frontend leaves the compose box untouched on
    // failure so nothing is lost.
    return res.status(502).json({ error: "AI draft is temporarily unavailable. Try a template instead." });
  }
});

module.exports = router;
