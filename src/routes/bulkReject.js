// Bulk rejection at scale — 2026-08-09
// ---------------------------------------------------------------------------
// ApplicationsView.jsx's batchReject() previously only flipped
// applications.status to "rejected" in the database -- it never generated
// or sent a rejection email at all. The single-candidate reject flow
// (FeedbackModal) already does AI-drafted, sendable feedback; bulk reject
// silently skipped that entirely, so a recruiter rejecting hundreds of
// applicants in one action left every one of them with no email and no
// idea why. This route is the real fix: a real AI-drafted email is
// generated and sent for every candidate in the batch, honestly reporting
// per-candidate success/failure rather than claiming the whole batch
// succeeded.
//
// SECURITY: the frontend does NOT get to supply candidate email/name/
// score/skills directly -- this route looks up the real applications rows
// itself, scoped to req.companyId (from requireCompany) AND the given
// jobId, and ignores anything else about "who this candidate is" that a
// caller might try to pass. Without this, a caller could have used this
// route to send an arbitrary "rejection" email to any address by simply
// making up a candidate object -- the same class of bug already fixed
// elsewhere in this service's hardening pass (never trust client-supplied
// identity for a side-effecting action).
const express = require("express");
const { supabase } = require("../lib/supabase");
const { sendEmail } = require("../lib/email");
const { draftRejectionFeedback } = require("../lib/rejectionFeedback");
const { requireAuth, requireCompany } = require("../middleware/auth");

const router = express.Router();

const MAX_BATCH = 25; // per-request cap -- the frontend chunks larger selections into multiple calls

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Aggregated only -- counts how often each matched skill recurs among this
// job's already-shortlisted candidates, never any single other candidate's
// identity or raw data. Used for the "skills that stood out" line in the
// rejection email (the "skill-gap framing" comparison, confirmed scope).
function computeStandoutSkills(shortlistedRows) {
  const freq = new Map();
  for (const row of shortlistedRows) {
    for (const skill of Array.isArray(row.matched_skills) ? row.matched_skills : []) {
      const key = String(skill).trim();
      if (!key) continue;
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([skill]) => skill);
}

// POST /bulk-reject-feedback
// Body: { jobId, applicationIds: [uuid, ...] } (max 25)
// -> { results: [{ id, sent: true } | { id, sent: false, error }] }
router.post("/bulk-reject-feedback", requireAuth, requireCompany, async (req, res) => {
  const jobId = String(req.body?.jobId || "").trim();
  const applicationIds = Array.isArray(req.body?.applicationIds) ? req.body.applicationIds : [];

  if (!UUID_RE.test(jobId)) return res.status(400).json({ error: "A valid jobId is required." });
  if (applicationIds.length === 0) return res.status(400).json({ error: "applicationIds must be a non-empty array." });
  if (applicationIds.length > MAX_BATCH) {
    return res.status(400).json({ error: `A maximum of ${MAX_BATCH} candidates can be rejected per request.` });
  }

  try {
    // Job ownership check + title for the email prompt.
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("id, title, company_id")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) throw jobErr;
    if (!job || job.company_id !== req.companyId) {
      return res.status(404).json({ error: "Job not found." });
    }

    // Real, current application rows -- ownership-scoped to this company AND
    // this job. Anything requested that doesn't match (wrong company, wrong
    // job, already rejected/shortlisted, or simply doesn't exist) is silently
    // excluded here and reported as a per-id failure below, never assumed.
    const { data: targets, error: targetsErr } = await supabase
      .from("applications")
      .select("id, name, email, score, missing_skills, matched_skills, ats_summary")
      .eq("job_id", jobId)
      .eq("company_id", req.companyId)
      .in("id", applicationIds)
      .not("status", "in", "(rejected,shortlisted)");
    if (targetsErr) throw targetsErr;

    const foundIds = new Set((targets || []).map((t) => t.id));
    const results = applicationIds
      .filter((id) => !foundIds.has(id))
      .map((id) => ({ id, sent: false, error: "Not found, not owned by your company, or already actioned." }));

    // Aggregate standout-skills context once per request (same job, same
    // batch) rather than re-querying per candidate.
    const { data: shortlisted } = await supabase
      .from("applications")
      .select("matched_skills")
      .eq("job_id", jobId)
      .eq("company_id", req.companyId)
      .eq("status", "shortlisted");
    const standoutSkills = computeStandoutSkills(shortlisted || []);

    for (const app of targets || []) {
      if (!app.email) {
        results.push({ id: app.id, sent: false, error: "No email on file for this candidate." });
        continue;
      }
      try {
        const feedback = await draftRejectionFeedback({
          candidateName: app.name || "there",
          jobTitle: job.title,
          score: app.score,
          missingSkills: app.missing_skills || [],
          atsSummary: app.ats_summary || "",
          strengths: app.matched_skills || [],
          standoutSkills,
        });
        await sendEmail({ to: app.email, subject: `Update on your application for ${job.title}`, text: feedback });

        const { error: updateErr } = await supabase
          .from("applications")
          .update({ status: "rejected", feedback_sent: true, feedback_text: feedback, rejected_at: new Date().toISOString() })
          .eq("id", app.id);
        if (updateErr) throw updateErr;

        results.push({ id: app.id, sent: true });
      } catch (err) {
        console.error(`[bulk-reject-feedback] failed for application ${app.id}:`, err.message);
        // Deliberately NOT marked rejected in the DB if the email failed to
        // send or the draft failed to generate -- a candidate must never be
        // silently rejected with no notification. The recruiter can retry
        // just the failed ones (the frontend keeps failures selected).
        results.push({ id: app.id, sent: false, error: "Could not generate or send feedback for this candidate." });
      }
    }

    res.status(200).json({ results });
  } catch (err) {
    console.error("[bulk-reject-feedback]", err.message);
    res.status(500).json({ error: "Bulk rejection failed before any emails were sent. Please try again." });
  }
});

module.exports = router;
// Attached for unit testing only -- see the equivalent note in searchAssist.js.
module.exports.computeStandoutSkills = computeStandoutSkills;
module.exports.MAX_BATCH = MAX_BATCH;
