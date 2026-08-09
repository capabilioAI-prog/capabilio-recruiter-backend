// Offer letter AI draft — 2026-08-06
// ---------------------------------------------------------------------------
// FIXES: OfferManagement.jsx's "Generate Offer Letter" button previously
// called https://api.anthropic.com/v1/messages DIRECTLY FROM THE BROWSER
// with no Authorization/x-api-key header at all. Every real call 401'd
// silently, and the frontend's own catch block quietly returned a static
// template string instead -- so every "AI-generated" offer letter was
// actually the same hardcoded template, not real AI output, and (had it
// somehow included a key) embedding an Anthropic key in client bundle code
// would have leaked it publicly. This moves the call server-side, reusing
// the same askClaudeForJson pattern already used by generate-feedback in
// feedback.js, with the SAME graceful-degradation behavior (return 200 with
// a safe template on failure, never leave the recruiter stuck on an error).
//
// Human review is unaffected either way: OfferManagement.jsx's existing
// 2-step flow (Generate -> editable textarea -> explicit Send button) was
// always the actual approval gate, not the generation call itself -- that
// gate is untouched by this fix.
const express = require("express");
const { askClaudeForJson } = require("../lib/anthropic");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function fallbackLetter(offer) {
  return `Dear ${offer.candidateName},

We are thrilled to extend an offer of employment for the position of ${offer.jobTitle}.

After a thorough review of your background and experience, we are confident that you will be a tremendous asset to our team. We were particularly impressed by your skills and believe your contributions will help drive our mission forward.

OFFER DETAILS
─────────────────────────────
Position: ${offer.jobTitle}
${offer.department ? `Department: ${offer.department}` : ""}
Start Date: ${offer.startDate || "To be confirmed"}
Work Location: ${offer.workLocation || "Remote"}

COMPENSATION PACKAGE
─────────────────────────────
Base Salary: ${offer.currency} ${Number(offer.baseSalary || 0).toLocaleString()} per year
${offer.bonus ? `Performance Bonus: Up to ${offer.currency} ${Number(offer.bonus).toLocaleString()} annually` : ""}
${offer.equity && offer.equity !== "None" ? `Equity: ${offer.equity}` : ""}

NEXT STEPS
─────────────────────────────
Please review this offer and indicate your acceptance by ${offer.expiryDate || "within 5 business days"}. We would be happy to answer any questions you may have.

We are genuinely excited about the possibility of you joining our team and look forward to working together.

With excitement,
The Hiring Team`;
}

// POST /generate-offer-letter
// { candidateName, jobTitle, department, startDate, currency, baseSalary,
//   bonus, equity, workLocation, expiryDate } -> { letter: "<text>" }
// 2026-08-09: gated behind requireAuth -- this calls the Anthropic API on
// every request (real $ cost per call) and had no auth at all, so anyone
// with the URL could spam it for free. Generation itself is still
// unrestricted content-wise (any recruiter can draft a letter for any
// candidateName/jobTitle they type -- that's normal product behavior, not
// a vulnerability), only the "must be a logged-in recruiter" gate is new.
router.post("/generate-offer-letter", requireAuth, async (req, res) => {
  const offer = req.body || {};
  if (!offer.candidateName || !offer.jobTitle) {
    return res.status(400).json({ error: "candidateName and jobTitle are required." });
  }

  const system = `You write warm, professional job offer letters for a recruiting platform. \
Respond with ONLY a JSON object, no markdown fences: {"letter": "<full letter text, using \\n for line breaks>"}`;

  const prompt = `Candidate: ${offer.candidateName}
Role: ${offer.jobTitle}
Department: ${offer.department || "Engineering"}
Start Date: ${offer.startDate || "TBD"}
Base Salary: ${offer.currency || "USD"} ${Number(offer.baseSalary || 0).toLocaleString()}
Bonus: ${offer.bonus ? `${offer.currency || "USD"} ${Number(offer.bonus).toLocaleString()} annual bonus` : "No bonus"}
Equity: ${offer.equity || "None"}
Location: ${offer.workLocation || "Remote"}
Expiry: ${offer.expiryDate || "5 business days"}

Write a complete, professional offer letter. Include:
- Warm opening congratulating them
- Role details and responsibilities overview
- Compensation breakdown
- Benefits highlights
- Clear next steps and signature deadline
- Professional closing

Tone: warm but professional. Make them excited to join.`;

  try {
    const result = await askClaudeForJson({ system, prompt, maxTokens: 1200 });
    const letter = typeof result.letter === "string" ? result.letter : "";
    if (!letter.trim()) throw new Error("empty letter from model");
    return res.status(200).json({ letter });
  } catch (err) {
    console.error("generate-offer-letter: Claude call failed:", err.message);
    // Same graceful-degradation convention as generate-feedback: 200 with a
    // safe fallback template, not a 500 the recruiter has to notice/retry.
    return res.status(200).json({ letter: fallbackLetter(offer) });
  }
});

module.exports = router;
