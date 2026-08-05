const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Capabilio Recruiting <feedback@send.capabilio.online>";

/**
 * Sends an email via the Resend API. Throws on failure -- callers decide
 * whether a failed send should fail the whole request or just be logged
 * (see routes/feedback.js for the bulk-send tolerant behavior).
 */
async function sendEmail({ to, subject, text }) {
  if (!RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY env var -- cannot send email.");
  }
  if (!to) {
    throw new Error("sendEmail: missing recipient address.");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [to],
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${body.slice(0, 300)}`);
  }

  return res.json();
}

module.exports = { sendEmail };
