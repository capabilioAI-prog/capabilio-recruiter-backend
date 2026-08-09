// AI-assisted candidate search — 2026-08-09
// ---------------------------------------------------------------------------
// Translates a recruiter's free-text query ("senior React devs in
// Bangalore with 3+ years, open to offers") into the real, structured
// filters GET /partner/candidates already supports (see partnerBridge.js's
// advanced-filters commit for exactly what each field means). This is
// deliberately NOT a new search engine -- it's a translation layer in front
// of the existing, precise, non-fabricated filters. If a filter isn't
// mentioned in the query, it's simply omitted, never guessed.
//
// AI SAFETY: per this project's own rule that AI output is probabilistic,
// not authoritative, every field returned by Claude is validated and
// clamped here before it ever reaches the frontend or a real DB query --
// wrong type, out-of-range values, and unknown keys are all dropped
// server-side, never trusted blindly. Nothing here writes to the database
// or contacts a candidate; it only produces filter parameters the
// recruiter still explicitly runs (and can see/edit) via the existing
// advanced filter panel.
const express = require("express");
const { askClaudeForJson } = require("../lib/anthropic");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const PATH_TYPES = new Set(["student", "professional"]);
const EMPLOYMENT_STATUSES = new Set(["discoverable", "notice_period"]);
const SORT_VALUES = new Set(["elo", "experience", "tasks", "recent"]);

function clampNumber(v, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function sanitizeText(v, maxLen = 80) {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, maxLen);
  return t || null;
}

// Strict allowlist validator -- builds the final filters object field by
// field from whatever Claude returned, never spreads/passes through the
// raw model output.
function toSafeFilters(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {};

  const skill = sanitizeText(r.skill, 200);
  if (skill) out.skill = skill;

  const domain = sanitizeText(r.domain);
  if (domain) out.domain = domain;

  const career = sanitizeText(r.career);
  if (career) out.career = career;

  const location = sanitizeText(r.location);
  if (location) out.location = location;

  if (typeof r.pathType === "string" && PATH_TYPES.has(r.pathType)) out.pathType = r.pathType;
  if (typeof r.employmentStatus === "string" && EMPLOYMENT_STATUSES.has(r.employmentStatus)) {
    out.employmentStatus = r.employmentStatus;
  }

  const minElo = clampNumber(r.minElo, { min: 0, max: 3000 });
  if (minElo != null) out.minElo = minElo;

  let minExperience = clampNumber(r.minExperience, { min: 0, max: 50 });
  let maxExperience = clampNumber(r.maxExperience, { min: 0, max: 50 });
  if (minExperience != null && maxExperience != null && minExperience > maxExperience) {
    // Malformed range from the model (e.g. "3-5 years" misread backwards) --
    // swap rather than silently produce a filter that can never match.
    [minExperience, maxExperience] = [maxExperience, minExperience];
  }
  if (minExperience != null) out.minExperience = minExperience;
  if (maxExperience != null) out.maxExperience = maxExperience;

  const minTasks = clampNumber(r.minTasks, { min: 0, max: 1000 });
  if (minTasks != null) out.minTasks = minTasks;

  const minStreak = clampNumber(r.minStreak, { min: 0, max: 1000 });
  if (minStreak != null) out.minStreak = minStreak;

  const minJobReadiness = clampNumber(r.minJobReadiness, { min: 0, max: 100 });
  if (minJobReadiness != null) out.minJobReadiness = minJobReadiness;

  if (r.uanVerified === true) out.uanVerified = true;
  if (r.educationVerified === true) out.educationVerified = true;

  if (typeof r.sortBy === "string" && SORT_VALUES.has(r.sortBy)) out.sortBy = r.sortBy;

  return out;
}

const SYSTEM = `You translate a recruiter's plain-English candidate search into a structured JSON filter object for a real candidate search API. \
You do NOT invent candidates or answer the query yourself -- you only extract filter values that are explicitly stated or clearly implied in the text.

Respond with ONLY a JSON object, no markdown fences, no commentary. Only include a key if the query actually specifies that filter -- omit anything not mentioned rather than guessing a default.

Allowed keys and types:
{
  "skill": "comma-separated skill names mentioned, e.g. 'React,PostgreSQL'",
  "domain": "a broad field, e.g. 'Software Engineering', 'Data Science'",
  "career": "a specific role/title mentioned, e.g. 'Data Analyst'",
  "location": "a city/region mentioned, e.g. 'Bangalore'",
  "pathType": "student" or "professional" -- only if the query clearly says college/student/fresher (student) or professional/experienced (professional)",
  "employmentStatus": "discoverable" (open to offers) or "notice_period" (in notice period) -- only professional-path candidates have this",
  "minElo": number 0-3000 -- only if the query gives an explicit ELO/skill-score threshold, or says something like "senior"/"expert" (imply roughly 1000+) vs "junior"/"beginner" (imply nothing, don't set a floor)",
  "minExperience": number of years, if a minimum or "X+ years" is mentioned,
  "maxExperience": number of years, if an upper bound is mentioned,
  "minTasks": number -- only if the query asks for a minimum number of completed tasks/challenges,
  "minStreak": number -- only if a minimum activity streak in days is mentioned,
  "minJobReadiness": number 0-100 -- only if a minimum "job ready" percentage is mentioned,
  "uanVerified": true -- only if the query asks for verified employment history,
  "educationVerified": true -- only if the query asks for verified education,
  "sortBy": "elo" | "experience" | "tasks" | "recent" -- only if the query implies an ordering, e.g. "top candidates by score" -> "elo"
}`;

// POST /search-assist  { query: "senior React devs in Bangalore, 3+ years" }
// -> { filters: {...safe filters...}, interpretation: "<short recap>" }
router.post("/search-assist", requireAuth, async (req, res) => {
  const query = sanitizeText(req.body?.query, 300);
  if (!query) return res.status(400).json({ error: "query is required." });

  try {
    const result = await askClaudeForJson({
      system: SYSTEM,
      prompt: `Recruiter's search: "${query}"`,
      maxTokens: 400,
    });
    const filters = toSafeFilters(result);
    const interpretation = Object.keys(filters).length
      ? `Applied ${Object.keys(filters).length} filter${Object.keys(filters).length === 1 ? "" : "s"} from your search.`
      : "Couldn't identify specific filters in that search -- try mentioning a skill, location, role, or experience level.";
    return res.status(200).json({ filters, interpretation });
  } catch (err) {
    console.error("search-assist: Claude call failed:", err.message);
    // No fallback fabrication here (unlike offers.js/feedback.js's template
    // fallbacks) -- there's no safe default filter set to guess at. Empty
    // filters + a clear error is honest; a wrong guessed filter would
    // silently hide real candidates from the recruiter.
    return res.status(200).json({ filters: {}, interpretation: "Couldn't process that search right now -- try the filter panel below instead." });
  }
});

module.exports = router;
