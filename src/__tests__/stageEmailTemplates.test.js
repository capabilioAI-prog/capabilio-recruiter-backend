// Tests for lib/stageEmailTemplates.js -- the deterministic, non-AI
// stage-change notification templates used by routes/workflow.js. High
// value to cover: this is the one place a wrong change could either leak
// an unintended "rejected" auto-email (contradicting the explicit product
// decision that rejection always goes through the reviewable FeedbackModal
// flow) or silently stop notifying candidates on the allowed stages.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ALLOWED_AUTO_STAGES, buildStageEmail } = require("../lib/stageEmailTemplates");

test("ALLOWED_AUTO_STAGES contains exactly contacted/interview/offered", () => {
  assert.deepEqual([...ALLOWED_AUTO_STAGES].sort(), ["contacted", "interview", "offered"]);
});

test("ALLOWED_AUTO_STAGES never includes rejected", () => {
  // Explicit regression guard -- rejection must always go through the
  // AI-drafted, human-reviewed FeedbackModal flow, never this automatic path.
  assert.equal(ALLOWED_AUTO_STAGES.has("rejected"), false);
});

test("buildStageEmail returns null for a stage with no template", () => {
  assert.equal(buildStageEmail("rejected", { candidateName: "Alex", jobTitle: "Engineer" }), null);
  assert.equal(buildStageEmail("applied", { candidateName: "Alex", jobTitle: "Engineer" }), null);
  assert.equal(buildStageEmail("not-a-real-stage", {}), null);
});

for (const stage of ["contacted", "interview", "offered"]) {
  test(`buildStageEmail("${stage}") includes the candidate name and job title`, () => {
    const email = buildStageEmail(stage, { candidateName: "Priya Sharma", jobTitle: "Backend Engineer" });
    assert.ok(email, "expected a template for an allowed stage");
    assert.match(email.subject, /Backend Engineer/);
    assert.match(email.text, /Priya Sharma/);
    assert.match(email.text, /Backend Engineer/);
  });

  test(`buildStageEmail("${stage}") falls back gracefully when name/title are missing`, () => {
    const email = buildStageEmail(stage, {});
    assert.ok(email);
    assert.match(email.text, /Hi there/);
    assert.match(email.text, /the role/);
  });
}
