// Candidate Tasks (inbound partner bridge) — 2026-08-06
// ---------------------------------------------------------------------------
// The recruiter-side "Tasks & Challenges" page (TasksChallenges.jsx) lets a
// recruiter assign a freeform task to a candidate, but that candidate lives
// in capabilio-web -- a completely separate app and Supabase project. Until
// now there was no way for the candidate to ever see or submit anything, so
// every assigned task sat at status="assigned" forever (the UI's own
// "no automated pass/fail" design intentionally excludes any grading here --
// it is NOT routed through Arena/ELO, per product decision).
//
// This route is the missing half: capabilio-web's OWN backend calls in here
// server-to-server (same shared-secret pattern as the existing outbound
// partnerBridge.js, just the reverse direction) on behalf of its logged-in
// candidate, to (a) list tasks assigned to that candidate and (b) submit
// their work back.
//
// SECURITY:
// - requirePartnerSecret fails CLOSED, identical posture to capabilio-web's
//   own partnerBridge.js: missing secret -> 503, mismatched secret -> 401.
// - This route trusts that capabilio-web has already authenticated the
//   candidate itself (it's the only caller, and the secret never reaches a
//   browser) -- but it STILL enforces candidateId ownership at the DB layer
//   on submit (WHERE candidate_id = :candidateId) as defense in depth, so a
//   bug on the calling side can't let one candidate submit into another
//   candidate's task by guessing a task id.
// - Tasks created without a real candidate_id (recruiter typed a name with
//   no linked candidate) are invisible here by design -- they were never
//   deliverable and this does not change that.
// - Submission is only accepted while status is "assigned" or "started" --
//   once a recruiter has moved a task to submitted/evaluated/passed/failed,
//   a resubmission is rejected (409) rather than silently overwriting a
//   reviewed result.
const express = require("express");
const { supabase } = require("../lib/supabase");

const router = express.Router();

function requirePartnerSecret(req, res, next) {
  const expected = process.env.PARTNER_BRIDGE_SECRET;
  if (!expected) {
    return res.status(503).json({ error: "Partner bridge not configured on this deployment." });
  }
  const provided = req.headers["x-partner-secret"];
  if (provided !== expected) {
    return res.status(401).json({ error: "Invalid partner credentials." });
  }
  next();
}

router.use(requirePartnerSecret);

const TASK_FIELDS =
  "id, company_id, job_id, title, description, status, assigned_at, started_at, submitted_at, evaluated_at, evaluator_notes, submission_text, submission_url";

// GET /partner/candidate-tasks?candidateId=<capabilio-web profile id>
router.get("/partner/candidate-tasks", async (req, res) => {
  try {
    const candidateId = (req.query.candidateId || "").trim();
    if (!candidateId) return res.status(400).json({ error: "candidateId query param is required." });

    const { data: tasks, error } = await supabase
      .from("tasks_challenges")
      .select(TASK_FIELDS)
      .eq("candidate_id", candidateId)
      .order("assigned_at", { ascending: false });

    if (error) throw error;

    // Best-effort company name lookup (no FK embed relied on -- companies
    // and tasks_challenges may not have a declared FK in PostgREST's schema
    // cache, so this is done as a second explicit query instead of a
    // ?select= embed that could silently 400).
    const companyIds = [...new Set((tasks || []).map((t) => t.company_id).filter(Boolean))];
    let namesById = {};
    if (companyIds.length) {
      const { data: companies } = await supabase.from("companies").select("id, name").in("id", companyIds);
      namesById = Object.fromEntries((companies || []).map((c) => [c.id, c.name]));
    }

    res.json({ tasks: (tasks || []).map((t) => ({ ...t, company_name: namesById[t.company_id] || null })) });
  } catch (err) {
    console.error("[partner/candidate-tasks]", err.message);
    res.status(500).json({ error: "Could not load tasks." });
  }
});

// POST /partner/candidate-tasks/:id/submit
// Body: { candidateId, submissionText, submissionUrl }
router.post("/partner/candidate-tasks/:id/submit", async (req, res) => {
  try {
    const { id } = req.params;
    const candidateId = (req.body?.candidateId || "").trim();
    const submissionText = (req.body?.submissionText || "").trim();
    const submissionUrl = (req.body?.submissionUrl || "").trim();

    if (!candidateId) return res.status(400).json({ error: "candidateId is required." });
    if (!submissionText && !submissionUrl) {
      return res.status(400).json({ error: "submissionText or submissionUrl is required." });
    }

    const { data: updated, error } = await supabase
      .from("tasks_challenges")
      .update({
        submission_text: submissionText || null,
        submission_url: submissionUrl || null,
        status: "submitted",
        submitted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("candidate_id", candidateId)
      .in("status", ["assigned", "started"])
      .select(TASK_FIELDS)
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      // Either the task doesn't exist, doesn't belong to this candidate, or
      // has already moved past assigned/started -- don't leak which.
      return res.status(409).json({ error: "This task can no longer be submitted to." });
    }

    res.json({ task: updated });
  } catch (err) {
    console.error("[partner/candidate-tasks/submit]", err.message);
    res.status(500).json({ error: "Could not submit task." });
  }
});

module.exports = router;
