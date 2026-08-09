// Tests for routes/apply.js's tryResolveCapabilioProfile -- the 2026-08-09
// dual-track resume+profile addition. The single hard requirement this
// guards: this lookup must NEVER throw or block the public apply flow, no
// matter what goes wrong (bad input, bridge not configured, network error,
// no match) -- apply.js's insert must always be reachable.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-dummy-key";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-dummy-key";
// Deliberately NOT setting CAPABILIO_WEB_API_URL / PARTNER_BRIDGE_SECRET --
// this test asserts the "bridge not configured" path degrades gracefully,
// same as it would on a deploy where those env vars are missing.
delete process.env.CAPABILIO_WEB_API_URL;
delete process.env.PARTNER_BRIDGE_SECRET;

const test = require("node:test");
const assert = require("node:assert/strict");
const { tryResolveCapabilioProfile, USERNAME_RE } = require("../routes/apply");

test("USERNAME_RE accepts typical usernames", () => {
  assert.ok(USERNAME_RE.test("gopi_nelluri"));
  assert.ok(USERNAME_RE.test("gopi.nelluri-99"));
});

test("USERNAME_RE rejects empty string and values with spaces/special chars", () => {
  assert.equal(USERNAME_RE.test(""), false);
  assert.equal(USERNAME_RE.test("has space"), false);
  assert.equal(USERNAME_RE.test("weird$chars!"), false);
});

test("tryResolveCapabilioProfile resolves to null (never throws) for empty/blank username", async () => {
  assert.equal(await tryResolveCapabilioProfile(""), null);
  assert.equal(await tryResolveCapabilioProfile(undefined), null);
  assert.equal(await tryResolveCapabilioProfile(null), null);
});

test("tryResolveCapabilioProfile resolves to null (never throws) for an invalid username shape", async () => {
  assert.equal(await tryResolveCapabilioProfile("has spaces!!"), null);
});

test("tryResolveCapabilioProfile resolves to null (never throws) when the partner bridge is not configured", async () => {
  // A valid-shaped username, but no CAPABILIO_WEB_API_URL/PARTNER_BRIDGE_SECRET
  // set (see the deletes above) -- callPartnerBridge throws a 503 internally;
  // this must be swallowed, not propagated, exactly like a real misconfigured
  // deploy should behave for the public apply form.
  const result = await tryResolveCapabilioProfile("real_looking_username");
  assert.equal(result, null);
});
