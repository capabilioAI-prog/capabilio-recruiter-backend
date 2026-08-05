const { askClaudeForJson } = require("./anthropic");

/**
 * Scores a resume against a job description using Claude.
 *
 * Claude's output is treated as probabilistic, not authoritative: every
 * field is validated/clamped here before use. A resume with no parseable
 * text (bad PDF, scanned image, etc.) still gets a conservative low score
 * with an explanatory summary rather than crashing the apply flow --
 * "AI unavailable" must never block a candidate's application from being
 * recorded.
 */
async function scoreResume({ resumeText, jobTitle, jobDescription }) {
  const trimmedResume = (resumeText || "").slice(0, 12000); // guard token usage

  if (!trimmedResume.trim()) {
    return {
      score: 0,
      matchedSkills: [],
      missingSkills: [],
      summary:
        "Resume text could not be extracted (empty or unreadable PDF). Please review the original file manually.",
    };
  }

  const system = `You are an ATS (Applicant Tracking System) resume screener for a recruiting platform. \
You score how well a candidate's resume matches a job posting. Be fair, consistent, and skill-first: \
judge based on demonstrated skills and experience, not pedigree, schools, or names. \
Respond with ONLY a JSON object, no markdown fences, no commentary, in exactly this shape:
{
  "score": <integer 0-100>,
  "matchedSkills": [<strings, skills/requirements the resume demonstrates>],
  "missingSkills": [<strings, required skills not evidenced in the resume>],
  "summary": "<2-3 sentence ATS summary of fit>"
}`;

  const prompt = `Job title: ${jobTitle || "Not specified"}

Job description:
${(jobDescription || "Not specified").slice(0, 6000)}

Resume text:
${trimmedResume}`;

  try {
    const result = await askClaudeForJson({ system, prompt, maxTokens: 800 });

    const score = Number.isFinite(result.score)
      ? Math.max(0, Math.min(100, Math.round(result.score)))
      : 0;

    return {
      score,
      matchedSkills: Array.isArray(result.matchedSkills) ? result.matchedSkills.slice(0, 20) : [],
      missingSkills: Array.isArray(result.missingSkills) ? result.missingSkills.slice(0, 20) : [],
      summary: typeof result.summary === "string" ? result.summary.slice(0, 1000) : "",
    };
  } catch (err) {
    console.error("scoreResume: Claude call failed:", err.message);
    // Degrade gracefully -- an AI outage must not block applications.
    return {
      score: 0,
      matchedSkills: [],
      missingSkills: [],
      summary: "Automated scoring is temporarily unavailable. Please review this application manually.",
    };
  }
}

module.exports = { scoreResume };
