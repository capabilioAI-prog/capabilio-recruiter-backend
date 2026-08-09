// Pipeline workflow automation — 2026-08-09
// ---------------------------------------------------------------------------
// RecruiterPipeline.jsx's Kanban board already writes real stage moves to
// pipeline_candidates (moveCard) but never notified the candidate. This
// route is the "auto-notify" half of mature workflow automation: when a
// recruiter moves a card to contacted/interview/offered (opt-in, see the
// frontend toggle), the frontend calls this route to send a deterministic
// status-update email. See lib/stageEmailTemplates.js for why this is
// template-based rather than AI-generated, and why "rejected" is excluded.
//
// This route does not read or write any database table itself -- the
// frontend has already performed and confirmed the actual stage-move
// write; this only sends the notification for that already-committed
// change. A failed send here must never look like the stage move failed.
const express = require("express");
const { sendEmail } = require("../lib/email");
const { ALLOWED_AUTO_STAGES, buildStageEmail } = require("../lib/stageEmailTemplates");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /workflow/stage-notify
// { candidateEmail, candidateName, jobTitle, stage } -> { sent: true }
router.post("/workflow/stage-notify", requireAuth, async (req, res) => {
  const candidateEmail = String(req.body?.candidateEmail || "").trim();
  const candidateName = String(req.body?.candidateName || "").trim();
  const jobTitle = String(req.body?.jobTitle || "").trim();
  const stage = String(req.body?.stage || "").trim();

  if (!candidateEmail) return res.status(400).json({ error: "candidateEmail is required." });
  if (!ALLOWED_AUTO_STAGES.has(stage)) {
    return res.status(400).json({ error: `Automatic notification is not supported for stage "${stage}".` });
  }

  const email = buildStageEmail(stage, { candidateName, jobTitle });
  try {
    await sendEmail({ to: candidateEmail, subject: email.subject, text: email.text });
    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error(`workflow/stage-notify: failed for ${candidateEmail} (stage=${stage}):`, err.message);
    // 502, not 500 -- this is an upstream (Resend) delivery failure, not a
    // bug in this route. The frontend treats this as non-blocking: the
    // stage move itself already succeeded before this call was made.
    return res.status(502).json({ sent: false, error: "Notification email failed to send." });
  }
});

module.exports = router;
