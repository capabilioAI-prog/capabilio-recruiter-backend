const express = require("express");
const crypto = require("crypto");
const { supabase } = require("../lib/supabase");
const { uploadMulti } = require("../middleware/uploadMulti");
const { extractPdfText } = require("../lib/pdf");
const { scoreResume } = require("../lib/scoreResume");
const { extractResumeIdentity } = require("../lib/extractResumeIdentity");
const { requireAuth, requireCompany } = require("../middleware/auth");

const router = express.Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /resume-screening/bulk-parse  (multipart/form-data: jobId, resumes[])
//
// Recruiter-side bulk resume screener. 2026-08-10: ResumeScreening.jsx
// previously ignored every uploaded file completely and cycled through 5
// hardcoded fake candidates -- confirmed by testing it directly. This route
// runs uploaded PDFs through the SAME pipeline the public /apply/:jobId
// endpoint already uses in production (extractPdfText + scoreResume), so a
// recruiter sourcing a resume externally (Naukri, LinkedIn, email) gets the
// exact same ATS scoring a candidate applying directly would get -- not a
// second, different, parallel scoring system. Nothing is written to
// `applications` here: this route only parses and scores. The frontend
// shows the recruiter an editable review step (AI-extracted name/email/
// phone are probabilistic, not authoritative -- see extractResumeIdentity.js)
// and a separate, explicit confirm step inserts the chosen rows, so a human
// always reviews before a resume becomes an authoritative applications row.
router.post("/resume-screening/bulk-parse", requireAuth, requireCompany, uploadMulti.array("resumes", 15), async (req, res) => {
  const jobId = (req.body?.jobId || "").trim();
  if (!UUID_RE.test(jobId)) {
    return res.status(400).json({ error: "Invalid or missing jobId." });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "At least one resume PDF is required." });
  }

  // Job must belong to the caller's own company -- req.companyId comes from
  // requireCompany (resolved server-side from the auth token), never from
  // client input, so this can't be used to score against another company's
  // job/requirements.
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select("id, company_id, title, jd_text, description, required_skills")
    .eq("id", jobId)
    .eq("company_id", req.companyId)
    .maybeSingle();
  if (jobErr) {
    console.error("resume-screening/bulk-parse: job lookup failed:", jobErr.message);
    return res.status(500).json({ error: "Could not load job." });
  }
  if (!job) {
    return res.status(404).json({ error: "Job not found." });
  }

  const jobDescriptionForScoring = [
    job.jd_text,
    job.description,
    Array.isArray(job.required_skills) && job.required_skills.length
      ? `Required skills: ${job.required_skills.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Sequential, not Promise.all across files: each file already fires 2
  // Claude calls internally (scoreResume + extractResumeIdentity), so
  // parallelizing across up to 15 files would burst 30 concurrent model
  // calls per request -- a real rate-limit risk for one recruiter's click.
  // A few extra seconds of latency here is a fair trade for not tripping
  // shared API limits.
  const results = [];
  for (const file of req.files) {
    const resumeText = await extractPdfText(file.buffer);

    const [scoreResult, identity] = await Promise.all([
      scoreResume({ resumeText, jobTitle: job.title, jobDescription: jobDescriptionForScoring }),
      extractResumeIdentity({ resumeText }),
    ]);

    // Best-effort storage upload, same bucket/path convention apply.js
    // uses -- a storage failure must not lose the parse/score work already
    // done, so this degrades to resumeUrl: null rather than failing the file.
    let resumeUrl = null;
    try {
      const path = `${jobId}/${crypto.randomUUID()}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from("resumes")
        .upload(path, file.buffer, { contentType: "application/pdf" });
      if (uploadErr) throw uploadErr;
      resumeUrl = path;
    } catch (err) {
      console.error("resume-screening/bulk-parse: resume upload failed (continuing without it):", err.message);
    }

    results.push({
      tempId: crypto.randomUUID(),
      filename: file.originalname,
      name: identity.name,
      email: identity.email,
      phone: identity.phone,
      resumeText: resumeText || null,
      resumeUrl,
      score: scoreResult.score,
      matchedSkills: scoreResult.matchedSkills,
      missingSkills: scoreResult.missingSkills,
      summary: scoreResult.summary,
    });
  }

  return res.status(200).json({
    job: { id: job.id, title: job.title },
    jobDescription: jobDescriptionForScoring,
    results,
  });
});

module.exports = router;
