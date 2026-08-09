// Tests for routes/jobDescription.js's fallbackDescription -- the safe
// degrade path used when the Claude call fails or returns malformed JSON.
// The route itself always returns 200 with this shape rather than a 500,
// same convention as generate-offer-letter/generate-feedback.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-dummy-key";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-dummy-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fallbackDescription } = require("../routes/jobDescription");

test("fallbackDescription returns a non-empty description mentioning the job title", () => {
  const out = fallbackDescription({ title: "Senior Data Analyst" });
  assert.ok(out.description.includes("Senior Data Analyst"));
});

test("fallbackDescription always returns arrays for responsibilities/requirements/niceToHave", () => {
  const out = fallbackDescription({ title: "Anything" });
  assert.ok(Array.isArray(out.responsibilities) && out.responsibilities.length > 0);
  assert.ok(Array.isArray(out.requirements) && out.requirements.length > 0);
  assert.ok(Array.isArray(out.niceToHave) && out.niceToHave.length > 0);
});
