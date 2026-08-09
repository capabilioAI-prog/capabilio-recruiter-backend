// Auth middleware — 2026-08-09 production-hardening pass
// ---------------------------------------------------------------------------
// PROBLEM THIS FIXES: every route in this service except candidateTasks.js
// (inbound, partner-secret gated) and apply.js (intentionally public) had
// ZERO authentication. partnerBridge.js's /partner/candidates/:id returned
// full candidate PII (name, ELO, skills, portfolio, career) to anyone who
// knew the URL, no token required. tasks.js accepted a client-supplied
// `companyId` body field and inserted tasks_challenges rows under it with no
// verification the caller belongs to that company -- a classic IDOR: any
// caller could attribute a task to a company_id they simply typed in, or
// read/message any candidate by id. The frontend (CandidateSearch.jsx,
// CandidateDetail.jsx, etc.) already sends `Authorization: Bearer
// <supabase access token>` on every call -- this backend just never checked
// it. This middleware makes that check real.
//
// requireAuth: verifies the bearer token against THIS service's own
// Supabase project (capabilio-recruiter's project, not capabilio-web's --
// these are two separate Supabase projects/user bases by design, see
// partnerBridge.js's file header) and attaches req.user. Fails closed:
// missing or invalid token -> 401, never falls through as anonymous.
//
// requireCompany: must run after requireAuth. Resolves the caller's own
// company_id from the `recruiters` table (recruiters.id = auth user id,
// same lookup TasksChallenges.jsx already does client-side) and attaches
// req.companyId. Routes that create/mutate company-scoped data should use
// req.companyId, NEVER a client-supplied companyId/partnerCompanyId body
// field, so a caller cannot act on behalf of a company they don't belong to.
const { supabase } = require("../lib/supabase");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ error: "Missing Authorization bearer token." });
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }
    req.user = data.user;
    next();
  } catch (err) {
    console.error("[requireAuth]", err.message);
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

async function requireCompany(req, res, next) {
  if (!req.user?.id) {
    // Defensive -- requireCompany is only ever wired in after requireAuth,
    // but fail closed rather than assume ordering was respected everywhere.
    return res.status(401).json({ error: "Missing Authorization bearer token." });
  }
  try {
    const { data: recruiterRow, error } = await supabase
      .from("recruiters")
      .select("company_id")
      .eq("id", req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!recruiterRow?.company_id) {
      return res.status(403).json({ error: "No company associated with this account." });
    }
    req.companyId = recruiterRow.company_id;
    // Real company name, not whatever a caller might put in a request body
    // -- used anywhere this identity is shown to a candidate/student (e.g.
    // "X Company sent you a message"). Two separate queries, not a
    // `companies(name)` embed -- RecruiterApp.jsx's own equivalent lookup
    // does the same (see its syncRecruiter()), since an FK embed here isn't
    // guaranteed to be in PostgREST's schema cache (same caution
    // candidateTasks.js's company-name lookup already documents).
    const { data: companyRow } = await supabase
      .from("companies")
      .select("name")
      .eq("id", recruiterRow.company_id)
      .maybeSingle();
    req.companyName = companyRow?.name ?? null;
    next();
  } catch (err) {
    console.error("[requireCompany]", err.message);
    return res.status(500).json({ error: "Could not resolve company for this account." });
  }
}

module.exports = { requireAuth, requireCompany };
