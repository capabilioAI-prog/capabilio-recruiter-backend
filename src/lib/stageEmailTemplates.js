// Deterministic stage-change notification templates — 2026-08-09
// ---------------------------------------------------------------------------
// Workflow-automation emails (unlike offer letters / rejection feedback)
// are intentionally NOT AI-generated. They fire automatically off a
// recruiter's own action (moving a pipeline card), so their content must
// be 100% predictable -- no risk of a probabilistic model saying something
// wrong/off-brand in an email a candidate receives with no human review.
// If a recruiter wants a personalized AI-drafted message for a candidate,
// the existing offer-letter / feedback-generation flows already cover
// that, each behind its own explicit human review-and-send step.
//
// "rejected" is deliberately NOT included here -- rejection already has a
// dedicated, more careful flow (ApplicationsView.jsx's FeedbackModal,
// AI-drafted feedback the recruiter reviews and edits before sending).
// Auto-firing a second, different rejection email from here would
// contradict that existing, intentional product decision.
const ALLOWED_AUTO_STAGES = new Set(["contacted", "interview", "offered"]);

function buildStageEmail(stage, { candidateName, jobTitle }) {
  const name = candidateName || "there";
  const job = jobTitle || "the role";

  switch (stage) {
    case "contacted":
      return {
        subject: `Update on your application for ${job}`,
        text: `Hi ${name},\n\nThanks again for applying to the ${job} position. We've reviewed your application and wanted to reach out -- our team will be in touch soon with next steps.\n\nWith respect,\nThe Hiring Team`,
      };
    case "interview":
      return {
        subject: `You're moving to interview for ${job}`,
        text: `Hi ${name},\n\nGood news -- we'd like to move forward with an interview for the ${job} position. Our team will reach out shortly with scheduling details.\n\nWith respect,\nThe Hiring Team`,
      };
    case "offered":
      return {
        subject: `An update on your ${job} application`,
        text: `Hi ${name},\n\nWe're excited to move forward with next steps on an offer for the ${job} position. Expect to hear from our team directly very soon with full details.\n\nWith respect,\nThe Hiring Team`,
      };
    default:
      return null;
  }
}

module.exports = { ALLOWED_AUTO_STAGES, buildStageEmail };
