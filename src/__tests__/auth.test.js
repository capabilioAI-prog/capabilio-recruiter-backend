// Tests for middleware/auth.js -- requireAuth and requireCompany are the
// single enforcement point for this session's core security fix (this
// service previously had ZERO authentication on nearly every route, see
// that file's header comment). These tests call the middleware functions
// directly with mock req/res/next objects and a mocked Supabase client
// (via node:test's per-test t.mock, auto-restored after each test) --
// no real network call, no real Supabase project needed.
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-dummy-key";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "test-dummy-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const { supabase } = require("../lib/supabase");
const { requireAuth, requireCompany } = require("../middleware/auth");

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

// Builds a fake `.from(table).select(...).eq(...).maybeSingle()` chain
// that resolves to the given { data, error } regardless of which
// select/eq calls happen in between -- requireCompany's real queries are
// simple single-filter lookups, so a chain that just always resolves at
// maybeSingle() is a faithful enough stand-in.
function fakeQuery(result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return chain;
}

test("requireAuth: 401s with no Authorization header, never calls next", async () => {
  const req = { headers: {} };
  const res = mockRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Missing Authorization bearer token.");
  assert.equal(nextCalled, false);
});

test("requireAuth: 401s when Supabase reports an invalid/expired session", async (t) => {
  t.mock.method(supabase.auth, "getUser", async () => ({ data: { user: null }, error: { message: "invalid" } }));
  const req = { headers: { authorization: "Bearer bad-token" } };
  const res = mockRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Invalid or expired session.");
  assert.equal(nextCalled, false);
});

test("requireAuth: 401s (not a 500) when the Supabase call itself throws", async (t) => {
  t.mock.method(supabase.auth, "getUser", async () => { throw new Error("network blip"); });
  const req = { headers: { authorization: "Bearer some-token" } };
  const res = mockRes();
  await requireAuth(req, res, () => {});
  assert.equal(res.statusCode, 401);
});

test("requireAuth: sets req.user and calls next() on a valid token", async (t) => {
  const fakeUser = { id: "user-123", email: "recruiter@acme.com" };
  t.mock.method(supabase.auth, "getUser", async (token) => {
    assert.equal(token, "good-token");
    return { data: { user: fakeUser }, error: null };
  });
  const req = { headers: { authorization: "Bearer good-token" } };
  const res = mockRes();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, fakeUser);
  assert.equal(res.statusCode, null); // never touched res on success
});

test("requireCompany: 401s if requireAuth wasn't actually run first (defensive check)", async () => {
  const req = {};
  const res = mockRes();
  let nextCalled = false;
  await requireCompany(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test("requireCompany: 403s when the recruiter has no company_id", async (t) => {
  t.mock.method(supabase, "from", () => fakeQuery({ data: { company_id: null }, error: null }));
  const req = { user: { id: "user-123" } };
  const res = mockRes();
  let nextCalled = false;
  await requireCompany(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test("requireCompany: 500s if the recruiters lookup itself errors", async (t) => {
  t.mock.method(supabase, "from", () => fakeQuery({ data: null, error: { message: "db down" } }));
  const req = { user: { id: "user-123" } };
  const res = mockRes();
  await requireCompany(req, res, () => {});
  assert.equal(res.statusCode, 500);
});

test("requireCompany: sets req.companyId/req.companyName server-side and calls next()", async (t) => {
  let call = 0;
  t.mock.method(supabase, "from", (table) => {
    call += 1;
    if (table === "recruiters") return fakeQuery({ data: { company_id: "company-abc" }, error: null });
    if (table === "companies") return fakeQuery({ data: { name: "Acme Corp" }, error: null });
    throw new Error(`unexpected table: ${table}`);
  });
  const req = { user: { id: "user-123" } };
  const res = mockRes();
  let nextCalled = false;
  await requireCompany(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.companyId, "company-abc");
  assert.equal(req.companyName, "Acme Corp");
  assert.equal(call, 2); // recruiters lookup, then companies lookup -- never a joined embed
});

test("requireCompany: never trusts a client-supplied companyId -- req.companyId always comes from the DB lookup", async (t) => {
  t.mock.method(supabase, "from", () => fakeQuery({ data: { company_id: "real-company-id" }, error: null }));
  // Simulates a caller that tried to smuggle a different companyId onto
  // the request object before requireCompany runs (e.g. a route reading
  // it from the body first) -- requireCompany must overwrite it, not trust it.
  const req = { user: { id: "user-123" }, companyId: "attacker-supplied-id" };
  const res = mockRes();
  await requireCompany(req, res, () => {});
  assert.equal(req.companyId, "real-company-id");
});
