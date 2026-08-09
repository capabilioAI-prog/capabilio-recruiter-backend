// AI Hiring Assistant — 2026-08-09
// ---------------------------------------------------------------------------
// Per-candidate ATS scoring already happens automatically at apply time
// (see lib/scoreResume.js, called from POST /apply/:jobId) -- every
// application arriving in ApplicationsView.jsx already has a score,
// matchedSkills, missingSkills, and atsSummary. What's missing is a
// HOLISTIC view across an entire job's slate: given N already-scored
// candidates, which ones should the recruiter actually look at first, and
// why -- weighing which missing skills matter more for THIS role, not just
// a raw number.
//
// This route does NOT re-score resumes and does NOT touch the database. It
// takes the scoring data the frontend already has (one Supabase read,
// already RLS-scoped to the recruiter's own company) and asks Claude for a
// single holistic pass across the slate: a short overall recommendation
// and a tier per candidate. It is advisory only -- see requireAuth below
// and the frontend integration, which renders this as a read-only panel.
// NOTHING here writes application status, moves a pipeline stage, sends a
// rejection, or otherwise takes an authoritative action; only an explicit
// human click (existing Shortlist/Reject buttons, unchanged by this route)
// does that. This satisfies the project rule that AI must not silently
// make hiring decisions -- it assists, a person still decides.
const express = require("express");
const { askClaudeForJson } = require("../lib/anthropic");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const TIERS = new Set(["Strong Fit", "Consider", "Not Recommended"]);
const MAX_CANDIDATES = 30; // guards prompt size / cost per call

function scoreTier(score) {
  const s = Number(score) || 0;
  if (s >= 75) return "Strong Fit";
  if (s >= 50) return "Consider";
  return "Not Recommended";
}

function sanitizeCandidateInput(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(raw.name || "Candidate").slice(0, 120),
    score: Number.isFinite(Number(raw.score)) ? Math.max(0, Math.min(100, Number(raw.score))) : 0,
    matchedSkills: Array.isArray(raw.matchedSkills) ? raw.matchedSkills.slice(0, 15).map((s) => String(s).slice(0, 60)) : [],
    missingSkills: Array.isArray(raw.missingSkills) ? raw.missingSkills.slice(0, 15).map((s) => String(s).slice(0, 60)) : [],
    atsSummary: String(raw.atsSummary || "").slice(0, 400),
  };
}

function fallbackRecommendation(candidates, note) {
  // Deterministic, score-derived fallback -- used when Claude fails
  // entirely, or to fill in any candidate id Claude's response omitted.
  // Never fabricated: every value here is computed directly from the real
  // score already on the application.
  return {
    overallSummary: note,
    candidates: candidates.map((c) => ({
      id: c.id,
      tier: scoreTier(c.score),
      reasoning: "Based on ATS score only (AI assessment unavailable for this candidate).",
    })),
  };
}

const SYSTEM = `You are a hiring assistant for a recruiting platform. You are given a job and a list of candidates who already have an ATS match score (0-100), matched skills, missing skills, and a short summary -- all computed by a separate, already-run scoring pass. \
Your job is NOT to re-score them. Your job is to give a holistic read across the whole slate: which candidates are actually worth prioritizing for this specific role, and why -- e.g. two candidates might have similar scores but one is missing a skill that's a hard requirement while the other is missing something minor.

Respond with ONLY a JSON object, no markdown fences, no commentary, in exactly this shape:
{
  "overallSummary": "<3-5 sentence recommendation on how to approach this slate -- who to prioritize and why, referencing specific candidates by name>",
  "candidates": [
    { "id": "<the exact id given for this candidate>", "tier": "Strong Fit" | "Consider" | "Not Recommended", "reasoning": "<1-2 sentence holistic reasoning, specific to this candidate and role>" }
  ]
}
Include every candidate id you were given, exactly once. This is advisory input for a human recruiter who makes the actual decision -- do not claim certainty, and do not recommend rejecting anyone outright without qualification.`;

// POST /hiring-assistant/recommend
// Body: { jobTitle, jobDescription, candidates: [{ id, name, score, matchedSkills, missingSkills, atsSummary }] }
router.post("/hiring-assistant/recommend", requireAuth, async (req, res) => {
  const jobTitle = String(req.body?.jobTitle || "").trim().slice(0, 200);
  const jobDescription = String(req.body?.jobDescription || "").trim().slice(0, 4000);
  const rawCandidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
  const candidates = rawCandidates.map(sanitizeCandidateInput).filter(Boolean).slice(0, MAX_CANDIDATES);

  if (!jobTitle) return res.status(400).json({ error: "jobTitle is required." });
  if (candidates.length === 0) return res.status(400).json({ error: "At least one candidate is required." });

  const prompt = `Job title: ${jobTitle}

Job description:
${jobDescription || "Not provided"}

Candidates (${candidates.length}):
${candidates
  .map(
    (c, i) => `${i + 1}. id="${c.id}" name="${c.name}" score=${c.score}
   matched skills: ${c.matchedSkills.join(", ") || "none listed"}
   missing skills: ${c.missingSkills.join(", ") || "none listed"}
   summary: ${c.atsSummary || "none"}`
  )
  .join("\n")}`;

  try {
    const result = await askClaudeForJson({ system: SYSTEM, prompt, maxTokens: 1500 });

    const overallSummary = typeof result.overallSummary === "string" ? result.overallSummary.slice(0, 1500) : "";
    const byId = new Map();
    if (Array.isArray(result.candidates)) {
      for (const entry of result.candidates) {
        if (!entry || typeof entry !== "object") continue;
        const id = String(entry.id || "").trim();
        if (!id || !candidates.some((c) => c.id === id)) continue; // ignore ids we never sent
        const tier = TIERS.has(entry.tier) ? entry.tier : null;
        if (!tier) continue;
        byId.set(id, {
          id,
          tier,
          reasoning: typeof entry.reasoning === "string" ? entry.reasoning.slice(0, 500) : "",
        });
      }
    }
    // Any candidate Claude's response omitted or returned invalid data for
    // still gets a deterministic score-derived entry -- the recruiter
    // should never see a candidate silently missing from the assistant's
    // output.
    const recommendations = candidates.map(
      (c) =>
        byId.get(c.id) || {
          id: c.id,
          tier: scoreTier(c.score),
          reasoning: "Based on ATS score only (AI did not return an assessment for this candidate).",
        }
    );

    return res.status(200).json({
      overallSummary: overallSummary || "AI summary unavailable -- showing score-based tiers below.",
      candidates: recommendations,
    });
  } catch (err) {
    console.error("hiring-assistant/recommend: Claude call failed:", err.message);
    return res.status(200).json(
      fallbackRecommendation(candidates, "AI Hiring Assistant is temporarily unavailable -- showing score-based ranking only. Please review candidates manually.")
    );
  }
});

module.exports = router;
// Attached for unit testing only -- see the equivalent note in searchAssist.js.
module.exports.scoreTier = scoreTier;
module.exports.sanitizeCandidateInput = sanitizeCandidateInput;
module.exports.fallbackRecommendation = fallbackRecommendation;
