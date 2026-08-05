const Anthropic = require("@anthropic-ai/sdk");

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error("Missing ANTHROPIC_API_KEY env var.");
}

const anthropic = new Anthropic({ apiKey });

const MODEL = "claude-sonnet-4-5-20250929";

/**
 * Calls Claude and asks for strict JSON back. Claude output is treated as
 * probabilistic, not authoritative -- callers MUST validate/clamp fields
 * themselves (see scoreResume.js, feedback.js) rather than trusting shape
 * or ranges blindly.
 */
async function askClaudeForJson({ system, prompt, maxTokens = 1024 }) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // Claude sometimes wraps JSON in ```json fences despite instructions --
  // strip those before parsing rather than failing the whole request.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    throw new Error(`Claude did not return valid JSON: ${text.slice(0, 300)}`);
  }
}

module.exports = { anthropic, askClaudeForJson, MODEL };
