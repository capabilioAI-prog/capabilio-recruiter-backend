const { askClaudeForJson } = require("./anthropic");

// Deterministic regex extraction -- always run, regardless of whether the
// AI call below succeeds. Email in particular has an unambiguous, checkable
// format, so there is no reason to depend on a probabilistic model for it
// when it's present verbatim in the text; this also gives scoreResume-style
// AI unavailability a safe, still-useful degrade path instead of returning
// nothing at all.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?(?:\d[\s-]?){9,12}\d/;

function regexExtract(resumeText) {
  const email = resumeText.match(EMAIL_RE)?.[0]?.toLowerCase() || null;
  const phoneMatch = resumeText.match(PHONE_RE)?.[0]?.replace(/\s{2,}/g, " ").trim() || null;
  // Phone regex is loose (resumes format numbers wildly) -- reject obvious
  // false positives like a lone 9-12 digit run that's actually a pincode or
  // ID number by requiring at least one separator or a leading +, otherwise
  // drop it rather than pass through noise.
  const phone = phoneMatch && (phoneMatch.includes("-") || phoneMatch.includes(" ") || phoneMatch.startsWith("+"))
    ? phoneMatch
    : null;
  return { email, phone };
}

/**
 * Best-effort extraction of a candidate's name/email/phone from raw resume
 * text, for recruiter-side bulk uploads where (unlike the public apply form)
 * nobody typed these in a form field first. Treated as a starting point for
 * human review, not an authoritative record -- the frontend must let a
 * recruiter see and correct these before they're saved to `applications`.
 * Email/phone additionally get a deterministic regex cross-check/fallback
 * since those have a checkable format, unlike name.
 */
async function extractResumeIdentity({ resumeText }) {
  const text = (resumeText || "").slice(0, 6000); // name/contact info is always near the top
  const fallback = regexExtract(resumeText || "");

  if (!text.trim()) {
    return { name: null, email: fallback.email, phone: fallback.phone };
  }

  try {
    const system = `Extract ONLY the candidate's name, email, and phone number from this resume text. \
Respond with ONLY a JSON object, no markdown fences: {"name":"<string or null>","email":"<string or null>","phone":"<string or null>"}. \
Use null for any field not clearly present -- never invent one.`;
    const result = await askClaudeForJson({ system, prompt: text, maxTokens: 200 });
    const name = typeof result.name === "string" && result.name.trim() ? result.name.trim().slice(0, 200) : null;
    // AI-extracted email/phone are cross-checked against the regex result --
    // if the AI's email doesn't even look like an email, or the regex found
    // one and the AI didn't, prefer the regex (checkable) over the AI (not).
    const aiEmail = typeof result.email === "string" && EMAIL_RE.test(result.email) ? result.email.toLowerCase() : null;
    const email = aiEmail || fallback.email;
    const phone = (typeof result.phone === "string" && result.phone.trim().slice(0, 40)) || fallback.phone;
    return { name, email, phone };
  } catch (err) {
    console.error("extractResumeIdentity: Claude call failed, using regex fallback only:", err.message);
    return { name: null, email: fallback.email, phone: fallback.phone };
  }
}

module.exports = { extractResumeIdentity, regexExtract };
