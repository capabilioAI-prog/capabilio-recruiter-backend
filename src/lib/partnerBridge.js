// Shared client for capabilio-web's partner-bridge API — 2026-08-09.
// ---------------------------------------------------------------------------
// Extracted out of src/routes/partnerBridge.js so it can also be called from
// src/routes/apply.js (the public, unauthenticated apply form) without going
// through that route's own requireAuth/requireCompany gates, which exist to
// protect a *recruiter's browser* calling this service, not this service
// calling capabilio-web server-to-server. Behavior is unchanged from the
// original inline version in routes/partnerBridge.js.
//
// Required env vars on this service:
//   CAPABILIO_WEB_API_URL   e.g. https://capabilio-web.onrender.com
//   PARTNER_BRIDGE_SECRET   must match the same value set on capabilio-web's
//                           backend (PARTNER_BRIDGE_SECRET there)
const WEB_API_URL = process.env.CAPABILIO_WEB_API_URL;
const PARTNER_SECRET = process.env.PARTNER_BRIDGE_SECRET;

async function callPartnerBridge(method, path, { query = {}, body } = {}) {
  if (!WEB_API_URL || !PARTNER_SECRET) {
    const err = new Error("Partner bridge not configured (missing CAPABILIO_WEB_API_URL or PARTNER_BRIDGE_SECRET)");
    err.status = 503;
    throw err;
  }
  const qs = new URLSearchParams(query).toString();
  const url = `${WEB_API_URL}/api/partner/${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      "x-partner-secret": PARTNER_SECRET,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const responseBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(responseBody.error || `Partner bridge request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return responseBody;
}

module.exports = { callPartnerBridge };
