const express = require("express");
const crypto = require("crypto");
const { supabase } = require("../lib/supabase");
const { upload } = require("../middleware/upload");
const { extractPdfText } = require("../lib/pdf");
const { scoreResume } = require("../lib/scoreResume");

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const { score, matchedSkills, missingSkills, summary } = await scoreResume({
    resumeText,
    jobTitle: job.title,
    jobDescription: jobDescriptionForScoring,
  });

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

  const candidateId = crypto.randomUUID();

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
