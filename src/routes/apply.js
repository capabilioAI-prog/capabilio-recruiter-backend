const express = require("express");
const crypto = require("crypto");
const { supabase } = require("../lib/supabase");
const { upload } = require("../middleware/upload");
const { extractPdfText } = require("../lib/pdf");
const { scoreResume } = require("../lib/scoreResume");
const { callPartnerBridge } = require("../lib/partnerBridge");

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

// 2026-08-09 dual-track resume+profile matching: "add both Resume scoring
// and capabilio profile because everyone won't come straightaway to
// capabilio so in meanwhile capabilio can go with resume things and slowly
// i will remove resume from capabilio eco-system." This is strictly
// ADDITIVE -- resume upload/scoring below is completely unchanged for every
// applicant, linked profile or not. When capabilio_username is supplied,
// this best-effort resolves it to a real, recruiter_discoverable profile on
// capabilio-web via the partner bridge (see lib/partnerBridge.js and
// capabilio-web's GET /candidates/by-username/:username). Any failure here
// (not configured, network error, no match, private profile) must NEVER
// block or fail the public apply flow -- it's a candidate submitting a job
// application, not a Capabilio account action.
async function tryResolveCapabilioProfile(capabilioUsername) {
  if (!capabilioUsername || !USERNAME_RE.test(capabilioUsername)) return null;
  try {
    const { candidate } = await callPartnerBridge("GET", `candidates/by-username/${encodeURIComponent(capabilioUsername)}`);
    return candidate || null;
  } catch (err) {
    // Includes the expected 404 "no matching profile" case as well as any
    // real failure (bridge not configured, network error) -- both simply
    // mean "no verified profile to attach," never an apply failure.
    console.warn("apply: capabilio profile lookup skipped:", err.message);
    return null;
  }
}

// POST /apply/:jobId  (multipart/form-data: name, email, phone,
// capabilio_username, resume)
//
// Public, unauthenticated endpoint -- this is the candidate-facing job
// application form. Never trust any of this input.
router.post("/apply/:jobId", upload.single("resume"), async (req, res) => {
  const { jobId } = req.params;

  if (!UUID_RE.test(jobId)) {
    return res.status(400).json({ error: "Invalid job id." });
  }

  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim();
  const phone = (req.body.phone || "").trim();
  const capabilioUsername = (req.body.capabilio_username || "").trim();

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required." });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Resume PDF is required." });
  }

  // Look up the job (service role bypasses RLS -- this route is
  // intentionally public, mirroring the original Firestore app's posture).
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, company_id, title, status, jd_text, description, required_skills")
    .eq("id", jobId)
    .maybeSingle();

  if (jobErr) {
    console.error("apply: job lookup failed:", jobErr.message);
    return res.status(500).json({ error: "Could not load job." });
  }
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }
  // Case-insensitive: JobBoard.jsx writes "Open"/"Draft"/"Closed".
  if ((job.status || "").toLowerCase() === "closed") {
    return res.status(410).json({ error: "This job is no longer accepting applications." });
  }

  const resumeText = await extractPdfText(req.file.buffer);

  const jobDescriptionForScoring = [
    job.jd_text,
    job.description,
    Array.isArray(job.required_skills) && job.required_skills.length
      ? `Required skills: ${job.required_skills.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Run the resume score and the (optional, best-effort) verified-profile
  // lookup concurrently -- neither depends on the other, and the profile
  // lookup must add zero latency risk to the resume-scoring path it sits
  // alongside. scoreResume() is the authoritative, unchanged path; a
  // rejected profile lookup is swallowed inside tryResolveCapabilioProfile
  // itself, never here.
  const [{ score, matchedSkills, missingSkills, summary }, capabilioProfile] = await Promise.all([
    scoreResume({ resumeText, jobTitle: job.title, jobDescription: jobDescriptionForScoring }),
    tryResolveCapabilioProfile(capabilioUsername),
  ]);

  // Upload the original PDF to private storage for later recruiter review.
  // Best-effort: a storage failure should not lose the application.
  let resumeUrl = null;
  try {
    const path = `${jobId}/${crypto.randomUUID()}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from("resumes")
      .upload(path, req.file.buffer, { contentType: "application/pdf" });
    if (uploadErr) throw uploadErr;
    resumeUrl = path; // signed URL generated on demand when a recruiter views it
  } catch (err) {
    console.error("apply: resume upload failed (continuing without it):", err.message);
  }

  // candidate_id is the real profile id when a verified Capabilio profile
  // was resolved above (linking this application to that actual account),
  // and only falls back to a fresh random id for applicants with no linked
  // profile -- previously this was ALWAYS a random uuid, even when
  // capabilio_username was supplied, so it never actually linked anything.
  const candidateId = UUID_RE.test(capabilioProfile?.id || "") ? capabilioProfile.id : crypto.randomUUID();

  const { data: application, error: insertErr } = await supabase
    .from("applications")
    .insert({
      company_id: job.company_id,
      job_id: job.id,
      candidate_id: candidateId,
      name,
      email,
      phone: phone || null,
      capabilio_username: capabilioUsername || null,
      resume_text: resumeText || null,
      resume_url: resumeUrl,
      job_description: jobDescriptionForScoring || null,
      score,
      matched_skills: matchedSkills,
      missing_skills: missingSkills,
      ats_summary: summary,
      status: "applied",
      scored_at: new Date().toISOString(),
      // Additive verified-profile signal, never a replacement for the
      // resume-derived fields above -- see the 2026-08-09 dual-track note
      // on tryResolveCapabilioProfile().
      capabilio_profile_verified: !!capabilioProfile,
      capabilio_profile_data: capabilioProfile || null,
    })
    .select("id")
    .single();

  if (insertErr) {
    console.error("apply: insert failed:", insertErr.message);
    return res.status(500).json({ error: "Could not save application. Please try again." });
  }

  return res.status(200).json({ status: "application_received", applicationId: application.id });
});

module.exports = router;
// Attached for unit testing only -- see the equivalent note in bulkReject.js.
module.exports.tryResolveCapabilioProfile = tryResolveCapabilioProfile;
module.exports.USERNAME_RE = USERNAME_RE;
