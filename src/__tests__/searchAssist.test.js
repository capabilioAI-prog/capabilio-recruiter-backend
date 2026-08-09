// Tests for routes/searchAssist.js's toSafeFilters -- the strict allowlist
// validator that stands between raw Claude output and the real candidate
// search filters. This is the single most important thing to cover in this
// file: per the project's AI-safety rule, Claude output must never reach a
// real query unvalidated, and this function is the entire enforcement
// point for that rule on this endpoint.
//
// dummy env vars must be set BEFORE requiring the route module -- both
// lib/anthropic.js and lib/supabase.js (via middleware/auth.js) throw at
// require-time if their env vars are missing, since they construct real
// SDK clients eagerly. No network call is made by requiring the module or
// by calling toSafeFilters directly (it's a pure function), so dummy
// values are sufficient here.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-dummy-key";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-dummy-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const { toSafeFilters } = require("../routes/searchAssist");

test("drops keys not on the allowlist", () => {
  const out = toSafeFilters({ skill: "React", notAField: "malicious", __proto__: "x" });
  assert.deepEqual(out, { skill: "React" });
});

test("returns an empty object for non-object input", () => {
  assert.deepEqual(toSafeFilters(null), {});
  assert.deepEqual(toSafeFilters(undefined), {});
  assert.deepEqual(toSafeFilters("not an object"), {});
  assert.deepEqual(toSafeFilters(42), {});
});

test("clamps minElo to [0, 3000]", () => {
  assert.equal(toSafeFilters({ minElo: -50 }).minElo, 0);
  assert.equal(toSafeFilters({ minElo: 5000 }).minElo, 3000);
  assert.equal(toSafeFilters({ minElo: 900 }).minElo, 900);
  assert.equal(toSafeFilters({ minElo: "not a number" }).minElo, undefined);
});

test("clamps experience fields to [0, 50]", () => {
  const out = toSafeFilters({ minExperience: -5, maxExperience: 999 });
  assert.equal(out.minExperience, 0);
  assert.equal(out.maxExperience, 50);
});

test("swaps minExperience/maxExperience when Claude returns them backwards", () => {
  const out = toSafeFilters({ minExperience: 8, maxExperience: 3 });
  assert.equal(out.minExperience, 3);
  assert.equal(out.maxExperience, 8);
});

test("only accepts pathType from the fixed enum", () => {
  assert.equal(toSafeFilters({ pathType: "student" }).pathType, "student");
  assert.equal(toSafeFilters({ pathType: "professional" }).pathType, "professional");
  assert.equal(toSafeFilters({ pathType: "admin" }).pathType, undefined);
  assert.equal(toSafeFilters({ pathType: "'; DROP TABLE profiles; --" }).pathType, undefined);
});

test("only accepts employmentStatus from the fixed enum", () => {
  assert.equal(toSafeFilters({ employmentStatus: "discoverable" }).employmentStatus, "discoverable");
  assert.equal(toSafeFilters({ employmentStatus: "anything-else" }).employmentStatus, undefined);
});

test("only accepts sortBy from the fixed enum", () => {
  assert.equal(toSafeFilters({ sortBy: "elo" }).sortBy, "elo");
  assert.equal(toSafeFilters({ sortBy: "bogus" }).sortBy, undefined);
});

test("boolean flags are only set when strictly true", () => {
  assert.equal(toSafeFilters({ uanVerified: true }).uanVerified, true);
  assert.equal(toSafeFilters({ uanVerified: "true" }).uanVerified, undefined);
  assert.equal(toSafeFilters({ uanVerified: 1 }).uanVerified, undefined);
  assert.equal(toSafeFilters({ educationVerified: false }).educationVerified, undefined);
});

test("text fields are trimmed and length-capped", () => {
  const longSkill = "x".repeat(500);
  const out = toSafeFilters({ skill: longSkill, career: "  Data Analyst  " });
  assert.equal(out.skill.length, 200);
  assert.equal(out.career, "Data Analyst");
});

test("minJobReadiness clamps to [0, 100]", () => {
  assert.equal(toSafeFilters({ minJobReadiness: -10 }).minJobReadiness, 0);
  assert.equal(toSafeFilters({ minJobReadiness: 150 }).minJobReadiness, 100);
});
