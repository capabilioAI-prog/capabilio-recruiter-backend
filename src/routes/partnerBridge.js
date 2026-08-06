// Partner Bridge (proxy) — 2026-08-05, extended 2026-08-06
// ---------------------------------------------------------------------------
// capabilio-recruiter has its own Supabase project and its own recruiter
// accounts, completely separate from capabilio-web (where students,
// professionals, and colleges actually live). Rather than share auth across
// the two projects, this backend calls capabilio-web's own partner-bridge
// endpoints server-to-server, authenticated with a shared secret that never
// reaches the browser on either side.
//
// Required env vars on this service:
//   CAPABILIO_WEB_API_URL   e.g. https://capabilio-web.onrender.com
//   PARTNER_BRIDGE_SECRET   must match the same value set on capabilio-web's
//                           backend (PARTNER_BRIDGE_SECRET there)
//
// 2026-08-06: added the company-invites proxy (GET/accept/decline). A
// college's "Invite Company" action on capabilio-web writes a row into its
// own org_company_links table; this lets a logged-in recruiter here read the
// invites addressed to their own company (matched by email — see below) and
// accept/decline them without ever needing an account in capabilio-web's
// Supabase project. Email delivery for these invites has been turned off on
// purpose (product decision: connection only happens inside the
// application) — this proxy IS the only path an invite becomes visible or
// actionable now, so if CAPABILIO_WEB_API_URL/PARTNER_BRIDGE_SECRET aren't
// set correctly, invites are completely invisible, not just delayed.
//
// 2026-08-06 (later same day): added connected-college roster + per-student
// access-request proxies. A recruiter connected to a college can see that
// college's tier-scoped aggregate student roster and request contact access
// to ONE specific student — approval happens on the college's placement-cell
// side (capabilio-web), never here. See src/routes/tasks.js for where the
// approved/pending/denied status actually gets enforced (task assignment).
const express = require("express");
const router = express.Router();

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

// GET /api/partner/candidates -- real, recruiter_discoverable-gated candidates
// from capabilio-web. Same query params as capabilio-web's own recruiter
// search: skill, domain, minElo, verifiedOnly, limit, offset.
router.get("/partner/candidates", async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", "candidates", {
      query: { ...req.query, partnerName: "capabilio-recruiter" },
    });
    res.json(data);
  } catch (err) {
    console.error("[partner/candidates]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/institutions -- real list of colleges/institutions.
router.get("/partner/institutions", async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", "institutions");
    res.json(data);
  } catch (err) {
    console.error("[partner/institutions]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/company-invites?email=<recruiter's login email>
router.get("/partner/company-invites", async (req, res) => {
  try {
    const email = (req.query.email || "").trim();
    if (!email) return res.status(400).json({ error: "email query param is required." });
    const data = await callPartnerBridge("GET", "company-invites", { query: { email } });
    res.json(data);
  } catch (err) {
    console.error("[partner/company-invites]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/partner/company-invites/:id/accept
router.post("/partner/company-invites/:id/accept", async (req, res) => {
  try {
    const data = await callPartnerBridge("POST", `company-invites/${req.params.id}/accept`, {
      body: {
        partnerCompanyId: req.body?.partnerCompanyId,
        acceptedByEmail: req.body?.acceptedByEmail,
      },
    });
    res.json(data);
  } catch (err) {
    console.error("[partner/company-invites/accept]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/partner/company-invites/:id/decline
router.post("/partner/company-invites/:id/decline", async (req, res) => {
  try {
    const data = await callPartnerBridge("POST", `company-invites/${req.params.id}/decline`, {});
    res.json(data);
  } catch (err) {
    console.error("[partner/company-invites/decline]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/company-links?email=<recruiter's login email> -- this
// recruiter's own ACTIVE college connections.
router.get("/partner/company-links", async (req, res) => {
  try {
    const email = (req.query.email || "").trim();
    if (!email) return res.status(400).json({ error: "email query param is required." });
    const data = await callPartnerBridge("GET", "company-links", { query: { email } });
    res.json(data);
  } catch (err) {
    console.error("[partner/company-links]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/company-links/:linkId/students -- aggregate, tier-scoped
// roster for one connected college.
router.get("/partner/company-links/:linkId/students", async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", `company-links/${req.params.linkId}/students`);
    res.json(data);
  } catch (err) {
    console.error("[partner/company-links/students]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/partner/company-links/:linkId/students/:studentId/request-access
// Body: { partnerCompanyId, requestedByEmail, reason }
router.post("/partner/company-links/:linkId/students/:studentId/request-access", async (req, res) => {
  try {
    const data = await callPartnerBridge(
      "POST",
      `company-links/${req.params.linkId}/students/${req.params.studentId}/request-access`,
      {
        body: {
          partnerCompanyId: req.body?.partnerCompanyId,
          requestedByEmail: req.body?.requestedByEmail,
          reason: req.body?.reason,
        },
      }
    );
    res.json(data);
  } catch (err) {
    console.error("[partner/company-links/request-access]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/company-links/:linkId/access-requests -- this recruiter's
// own requests for this link, so the UI can show status per student.
router.get("/partner/company-links/:linkId/access-requests", async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", `company-links/${req.params.linkId}/access-requests`);
    res.json(data);
  } catch (err) {
    console.error("[partner/company-links/access-requests]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
