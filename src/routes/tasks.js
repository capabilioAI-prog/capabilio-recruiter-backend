// Task assignment (server-side, gated) — 2026-08-06
// ---------------------------------------------------------------------------
// TasksChallenges.jsx used to insert into tasks_challenges directly from the
// browser via the anon/authenticated Supabase client. That was fine from a
// same-project-RLS standpoint (company_id scoping was enforced by a DB
// trigger reading the session's current_company_id()), but it meant there
// was NO way to gate task assignment on a college's placement-cell approval
// for students reached through a college roster connection -- a recruiter
// could message/assign work to any candidate_id it happened to know.
//
// This route is now the ONLY path that creates a task. It distinguishes two
// lawful ways a recruiter reaches a candidate:
//   1. General Candidate Search (candidate has recruiter_discoverable=true
//      on capabilio-web) -- that candidate already explicitly opted into
//      recruiter contact. No companyLinkId is sent for this path; allowed
//      directly, same as before.
//   2. A college's connected roster (College Performance page) -- the
//      candidate never opted into anything themselves; contact only becomes
//      lawful once the college's placement cell approves a per-student
//      request (recruiter_student_access_requests, on capabilio-web).
//      companyLinkId is sent for this path; this route calls back into
//      capabilio-web's partner bridge to verify status === "approved"
//      before inserting anything. Anything else (pending/denied/none) 403s.
const express = require("express");
const { supabase } = require("../lib/supabase");

const router = express.Router();

const WEB_API_URL = process.env.CAPABILIO_WEB_API_URL;
const PARTNER_SECRET = process.env.PARTNER_BRIDGE_SECRET;

async function checkAccessApproved(linkId, studentId) {
  if (!WEB_API_URL || !PARTNER_SECRET) {
    const err = new Error("Partner bridge not configured (missing CAPABILIO_WEB_API_URL or PARTNER_BRIDGE_SECRET)");
    err.status = 503;
    throw err;
  }
  const url = `${WEB_API_URL}/api/partner/access-requests/${studentId}/status?linkId=${encodeURIComponent(linkId)}`;
  const res = await fetch(url, { headers: { "x-partner-secret": PARTNER_SECRET } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Access-status check failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body.status; // "approved" | "pending" | "denied" | "none"
}

// POST /tasks
// Body: { candidateId, candidateName, title, description, companyLinkId?, companyId }
router.post("/tasks", async (req, res) => {
  try {
    const candidateId = String(req.body?.candidateId || "").trim();
    const candidateName = String(req.body?.candidateName || "").trim();
    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();
    const companyLinkId = String(req.body?.companyLinkId || "").trim() || null;
    const companyId = String(req.body?.companyId || "").trim();

    if (!candidateName || !title) {
      return res.status(400).json({ error: "candidateName and title are required." });
    }
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required." });
    }

    if (companyLinkId) {
      if (!candidateId) {
        return res.status(400).json({ error: "candidateId is required when assigning via a college connection." });
      }
      const status = await checkAccessApproved(companyLinkId, candidateId);
      if (status !== "approved") {
        return res.status(403).json({
          error:
            status === "pending"
              ? "This student's placement cell hasn't approved contact yet."
              : status === "denied"
              ? "This student's placement cell declined contact access."
              : "You haven't requested contact access to this student yet.",
          accessStatus: status,
        });
      }
    }
    // No companyLinkId: candidate came from general Candidate Search, which
    // only ever returns recruiter_discoverable=true profiles -- already
    // self-consented, no additional gate needed here.

    const { data: task, error } = await supabase
      .from("tasks_challenges")
      .insert({
        company_id: companyId,
        candidate_id: candidateId || null,
        candidate_name: candidateName,
        title,
        description: description || null,
        status: "assigned",
      })
      .select()
      .single();
    if (error) throw error;

    res.status(200).json({ task });
  } catch (err) {
    console.error("[tasks/create]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
