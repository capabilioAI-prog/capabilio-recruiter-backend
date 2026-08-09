// Tests for routes/bulkReject.js's computeStandoutSkills -- the aggregation
// that must NEVER leak a single other candidate's identity or raw data
// into a rejection email, only recurring skill names across the job's
// shortlisted pool.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-dummy-key";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-dummy-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeStandoutSkills, MAX_BATCH } = require("../routes/bulkReject");

test("MAX_BATCH is a sane positive cap", () => {
  assert.ok(MAX_BATCH > 0 && MAX_BATCH <= 100);
});

test("computeStandoutSkills returns [] when no one has been shortlisted yet", () => {
  assert.deepEqual(computeStandoutSkills([]), []);
});

test("computeStandoutSkills ranks skills by how often they recur, most common first", () => {
  const rows = [
    { matched_skills: ["React", "TypeScript"] },
    { matched_skills: ["React", "Node.js"] },
    { matched_skills: ["React", "TypeScript", "SQL"] },
  ];
  const out = computeStandoutSkills(rows);
  assert.equal(out[0], "React"); // appears 3x
  assert.equal(out[1], "TypeScript"); // appears 2x
  assert.ok(out.includes("Node.js"));
  assert.ok(out.includes("SQL"));
});

test("computeStandoutSkills caps at 5 skills", () => {
  const rows = [{ matched_skills: ["a", "b", "c", "d", "e", "f", "g"] }];
  assert.equal(computeStandoutSkills(rows).length, 5);
});

test("computeStandoutSkills tolerates rows with missing/non-array matched_skills", () => {
  const rows = [{ matched_skills: null }, { matched_skills: "not-an-array" }, {}, { matched_skills: ["Python"] }];
  assert.deepEqual(computeStandoutSkills(rows), ["Python"]);
});

test("computeStandoutSkills never returns anything resembling candidate identity fields", () => {
  // Defensive: even if a caller accidentally passed richer rows (e.g. with
  // name/email present, as a real Supabase row might if the select() ever
  // changed), the output must only ever be skill strings from
  // matched_skills -- never leak those other fields into the output.
  const rows = [{ matched_skills: ["React"], name: "Someone Else", email: "someone@example.com" }];
  const out = computeStandoutSkills(rows);
  assert.deepEqual(out, ["React"]);
  assert.ok(!out.some((s) => s.includes("@")));
});
