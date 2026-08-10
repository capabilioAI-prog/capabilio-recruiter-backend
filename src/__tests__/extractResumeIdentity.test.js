// Tests for extractResumeIdentity.js's deterministic regex fallback --
// runs with no network/Claude dependency, and is the safety net that keeps
// email/phone extraction working even if the AI call fails or is unavailable.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-dummy-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const { regexExtract } = require("../lib/extractResumeIdentity");

test("regexExtract finds a plain email address", () => {
  const { email } = regexExtract("Contact me at Jane.Doe123@example.co.in for more info.");
  assert.equal(email, "jane.doe123@example.co.in");
});

test("regexExtract returns null email when none is present", () => {
  const { email } = regexExtract("Experienced software engineer with 5 years in backend systems.");
  assert.equal(email, null);
});

test("regexExtract finds a hyphenated/spaced phone number", () => {
  const { phone } = regexExtract("Phone: +91 98765-43210\nEmail: someone@example.com");
  assert.ok(phone && phone.includes("98765"));
});

test("regexExtract rejects a bare digit run with no separators (avoids false positives like pincodes/IDs)", () => {
  const { phone } = regexExtract("Employee ID 400072019283746 Bengaluru 560001");
  assert.equal(phone, null);
});
