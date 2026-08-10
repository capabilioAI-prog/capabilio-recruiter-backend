// Public candidate interview session route -- 2026-08-10 security fix.
// ---------------------------------------------------------------------------
// CandidateInterview.jsx serves an unauthenticated public route
// (/interview/:sessionId) for candidates with no Capabilio account -- the
// unguessable session UUID in the URL is the only "credential." It used to
// query Supabase's `interview_sessions` table directly from the browser via
// two RLS policies scoped to the `anon` role with `USING (true)` for both
// SELECT and UPDATE: no row-level restriction whatsoever. Postgres RLS
// evaluates row visibility, not "did the caller filter by a specific id" --
// so those policies didn't just let a candidate read/edit the one session
// they were sent a link to, they let ANYONE with the public anon key (which
// is embedded in the frontend bundle by design, trivially extractable) list
// or overwrite every interview session across every company in one
// unfiltered request. Confirmed via a live RLS audit before touching
// anything.
//
// Fix: move this exact-id-only access behind the backend, the same way
// every other sensitive read/write in this service already works. The
// anon RLS policies are dropped entirely (see the accompanying migration)
// -- interview_sessions is now reachable only via the recruiter's own
// authenticated company-scoped policy (creating sessions from
// ShadowInterview.jsx, unaffected by this change) or this service-role
// route, which always looks up/updates by exact primary key and never
// performs an unfiltered query.
const express = require("express");
const { supabase } = require("../lib/supabase");

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_STATUSES = ["in_progress", "completed"];

// GET /api/interview-session/:sessionId -- public, unauthenticated. Returns
// exactly one row by primary key, or 404. Never lists.
router.get("/interview-session/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  if (!UUID_RE.test(sessionId)) {
    return res.status(400).json({ error: "Invalid session id." });
  }
  try {
    const { data, error } = await supabase
      .from("interview_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Interview link not found or has expired." });
    res.json({ session: data });
  } catch (err) {
    console.error("[interview-session GET]", err.message);
    res.status(500).json({ error: "Could not load this interview session." });
  }
});

// PUT /api/interview-session/:sessionId -- public, unauthenticated.
// Body: { status?, transcript? } -- whitelisted fields only, updates by
// exact primary key. Never accepts or forwards anything else from the
// client (no company_id, no candidate identity fields -- those are already
// set when ShadowInterview.jsx creates the session as an authenticated
// recruiter action).
router.put("/interview-session/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  if (!UUID_RE.test(sessionId)) {
    return res.status(400).json({ error: "Invalid session id." });
  }

  const update = {};
  if (req.body?.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}` });
    }
    update.status = req.body.status;
  }
  if (req.body?.transcript !== undefined) {
    if (!Array.isArray(req.body.transcript)) {
      return res.status(400).json({ error: "transcript must be an array." });
    }
    update.transcript = req.body.transcript;
  }
  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: "Nothing to update -- provide status and/or transcript." });
  }

  try {
    const { data, error } = await supabase
      .from("interview_sessions")
      .update(update)
      .eq("id", sessionId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Interview link not found or has expired." });
    res.json({ session: data });
  } catch (err) {
    console.error("[interview-session PUT]", err.message);
    res.status(500).json({ error: "Could not save your progress. Please try again." });
  }
});

module.exports = router;
