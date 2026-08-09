const { askClaudeForJson } = require("./anthropic");

/**
 * Drafts a warm, honest rejection feedback email -- the bulk-reject
 * equivalent of feedback.js's POST /generate-feedback, extracted here so
 * routes/bulkReject.js can reuse the exact same prompt/validation
 * discipline without duplicating it, and without touching feedback.js's
 * already-working single-candidate flow at all.
 *
 * standoutSkills (optional): skill names that recurred among candidates
 * who moved forward for THIS job, computed server-side in bulkReject.js
 * from real, already-scored applications -- never another candidate's
 * name, email, resume, or identity. This is the "skill-gap framing" the
 * candidate chose: honest context on what tipped the decision, without
 * exposing who else applied.
 */
async function draftRejectionFeedback({ candidateName, jobTitle, score, missingSkills = [], atsSummary = "", strengths = [], standoutSkills = [] }) {
  const system = `You write warm, honest, encouraging candidate rejection feedback emails for a \
recruiting platform. Tone: respectful, specific, constructive -- never generic corporate boilerplate. \
${standoutSkills.length ? "You may briefly and kindly mention what skills stood out among candidates who moved forward, WITHOUT naming or describing any specific other candidate -- only the skill areas themselves." : ""} \
Respond with ONLY a JSON object, no markdown fences: {"feedback": "<full email body text, including a greeting and sign-off>"}`;

  const prompt = `Candidate: ${candidateName}
Role applied for: ${jobTitle}
ATS score: ${typeof score === "number" ? score : "not scored"}/100
ATS summary: ${atsSummary || "none"}
Strengths observed: ${(strengths || []).join(", ") || "none noted"}
Missing/gap skills: ${(missingSkills || []).join(", ") || "none noted"}
${standoutSkills.length ? `Skills that stood out among candidates who moved forward for this role: ${standoutSkills.join(", ")}` : ""}

Write the rejection feedback email now.`;

  const result = await askClaudeForJson({ system, prompt, maxTokens: 700 });
  const feedback = typeof result.feedback === "string" ? result.feedback.trim() : "";
  if (!feedback) throw new Error("empty feedback from model");
  return feedback;
}

module.exports = { draftRejectionFeedback };
