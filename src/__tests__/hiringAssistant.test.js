// Tests for routes/hiringAssistant.js's pure helpers: scoreTier (the
// deterministic fallback used whenever Claude fails or omits a candidate),
// sanitizeCandidateInput (the input-side allowlist, mirroring
// searchAssist's toSafeFilters but for the OTHER direction -- validating
// what's sent TO Claude), and fallbackRecommendation (the full-failure
// degrade path). Per the project's AI-safety rule, this endpoint must
// never silently drop a candidate from its output -- these tests guard
// that property directly.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-dummy-key";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-dummy-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreTier, sanitizeCandidateInput, fallbackRecommendation } = require("../routes/hiringAssistant");

test("scoreTier boundaries match the documented Strong/Consider/Not-Recommended thresholds", () => {
  assert.equal(scoreTier(100), "Strong Fit");
  assert.equal(scoreTier(75), "Strong Fit");
  assert.equal(scoreTier(74), "Consider");
  assert.equal(scoreTier(50), "Consider");
  assert.equal(scoreTier(49), "Not Recommended");
  assert.equal(scoreTier(0), "Not Recommended");
});

test("scoreTier treats non-numeric/missing scores as 0", () => {
  assert.equal(scoreTier(undefined), "Not Recommended");
  assert.equal(scoreTier(null), "Not Recommended");
  assert.equal(scoreTier("not a number"), "Not Recommended");
});

test("sanitizeCandidateInput returns null when id is missing or blank", () => {
  assert.equal(sanitizeCandidateInput(null), null);
  assert.equal(sanitizeCandidateInput({}), null);
  assert.equal(sanitizeCandidateInput({ id: "  " }), null);
});

test("sanitizeCandidateInput clamps score to [0, 100]", () => {
  assert.equal(sanitizeCandidateInput({ id: "a", score: -20 }).score, 0);
  assert.equal(sanitizeCandidateInput({ id: "a", score: 500 }).score, 100);
  assert.equal(sanitizeCandidateInput({ id: "a", score: "nope" }).score, 0);
});

test("sanitizeCandidateInput caps matched/missing skill arrays at 15 entries", () => {
  const many = Array.from({ length: 40 }, (_, i) => `skill-${i}`);
  const out = sanitizeCandidateInput({ id: "a", matchedSkills: many, missingSkills: many });
  assert.equal(out.matchedSkills.length, 15);
  assert.equal(out.missingSkills.length, 15);
});

test("sanitizeCandidateInput ignores non-array matched/missing skills", () => {
  const out = sanitizeCandidateInput({ id: "a", matchedSkills: "React,Node", missingSkills: null });
  assert.deepEqual(out.matchedSkills, []);
  assert.deepEqual(out.missingSkills, []);
});

test("fallbackRecommendation produces exactly one entry per candidate with a score-derived tier", () => {
  const candidates = [
    { id: "a", score: 90 },
    { id: "b", score: 60 },
    { id: "c", score: 10 },
  ];
  const result = fallbackRecommendation(candidates, "AI unavailable");
  assert.equal(result.overallSummary, "AI unavailable");
  assert.equal(result.candidates.length, 3);
  assert.deepEqual(
    result.candidates.map((c) => [c.id, c.tier]),
    [
      ["a", "Strong Fit"],
      ["b", "Consider"],
      ["c", "Not Recommended"],
    ]
  );
  // No candidate id is ever silently dropped from the fallback path.
  assert.deepEqual(result.candidates.map((c) => c.id).sort(), candidates.map((c) => c.id).sort());
});
