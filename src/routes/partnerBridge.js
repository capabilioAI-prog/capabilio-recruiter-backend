// Partner Bridge (proxy) — 2026-08-05
// ---------------------------------------------------------------------------
// capabilio-recruiter has its own Supabase project and its own recruiter
// accounts, completely separate from capabilio-web (where students,
// professionals, and colleges actually live). Rather than share auth across
// the two projects, this backend calls capabilio-web's own partner-bridge
// endpoints server-to-server, authenticated with a shared secret that never
// reaches the browser on either side.
//
// Required env vars on this service:
//   CAPABILIO_WEB_API_URL   e.g. https://capabilio-web-backend.onrender.com
//   PARTNER_BRIDGE_SECRET   must match the same value set on capabilio-web's
//                           backend (PARTNER_BRIDGE_SECRET there)
const express = require("express");
const router = express.Router();

const WEB_API_URL = process.env.CAPABILIO_WEB_API_URL;
const PARTNER_SECRET = process.env.PARTNER_BRIDGE_SECRET;

async function callPartnerBridge(path, query = {}) {
  if (!WEB_API_URL || !PARTNER_SECRET) {
    const err = new Error("Partner bridge not configured (missing CAPABILIO_WEB_API_URL or PARTNER_BRIDGE_SECRET)");
    err.status = 503;
    throw err;
  }
  const qs = new URLSearchParams(query).toString();
  const url = `${WEB_API_URL}/api/partner/${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: { "x-partner-secret": PARTNER_SECRET } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Partner bridge request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// GET /api/partner/candidates -- real, recruiter_discoverable-gated candidates
// from capabilio-web. Same query params as capabilio-web's own recruiter
// search: skill, domain, minElo, verifiedOnly, limit, offset.
router.get("/partner/candidates", async (req, res) => {
  try {
    const data = await callPartnerBridge("candidates", { ...req.query, partnerName: "capabilio-recruiter" });
    res.json(data);
  } catch (err) {
    console.error("[partner/candidates]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/institutions -- real list of colleges/institutions.
router.get("/partner/institutions", async (req, res) => {
  try {
    const data = await callPartnerBridge("institutions");
    res.json(data);
  } catch (err) {
    console.error("[partner/institutions]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
