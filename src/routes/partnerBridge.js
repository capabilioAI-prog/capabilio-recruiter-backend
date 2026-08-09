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
const { requireAuth, requireCompany } = require("../middleware/auth");
const { callPartnerBridge } = require("../lib/partnerBridge");
const router = express.Router();

// 2026-08-09 production-hardening: every route below previously had ZERO
// authentication on this service -- callPartnerBridge()'s shared secret
// only proves THIS SERVICE is legitimate to capabilio-web, it says nothing
// about who is calling THIS service from the browser. Anyone who knew a
// URL (e.g. GET /api/partner/candidates/:id) got full candidate PII with
// no token at all. requireAuth now verifies the caller is a real logged-in
// recruiter (capabilio-recruiter's own Supabase project). requireCompany
// additionally resolves the caller's real company_id/name server-side
// wherever the route previously trusted a client-supplied
// partnerCompanyId/companyName/email -- a caller could otherwise message
// or request access to a candidate while claiming to be a different
// company than the one they actually belong to.
//
// callPartnerBridge itself now lives in ../lib/partnerBridge.js (extracted
// 2026-08-09) so src/routes/apply.js -- a PUBLIC, unauthenticated route --
// can also call capabilio-web server-to-server (to resolve a candidate's
// capabilio_username) without going through this router's requireAuth,
// which exists to gate a recruiter's own browser, not this service's
// internal server-to-server calls.

// GET /api/partner/candidates -- real, recruiter_discoverable-gated candidates
// from capabilio-web. Same query params as capabilio-web's own recruiter
// search: skill, domain, minElo, verifiedOnly, limit, offset.
router.get("/partner/candidates", requireAuth, async (req, res) => {
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

// GET /api/partner/candidates/:id -- full candidate profile (skills, career
// timeline, AI interviews, certifications, portfolio artifacts). Added
// 2026-08-08: this proxy route never existed, even though capabilio-web
// grew a matching GET /candidates/:id -- every "View Profile" click in this
// app's Candidate Discovery / candidate detail page 401'd, but NOT because
// of a secret mismatch (the shared secret is fine -- every other route
// below works). It 401'd because there was no route here to forward the
// request at all: server.js's catch-all only returns a plain 404, so any
// deployed build serving that exact "Invalid partner credentials" message
// for this path was running code from before this bridge existed, or the
// request was somehow reaching capabilio-web directly rather than through
// this proxy. Either way, this route was simply missing -- adding it now.
router.get("/partner/candidates/:id", requireAuth, async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", `candidates/${req.params.id}`);
    res.json(data);
  } catch (err) {
    console.error("[partner/candidates/:id]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/partner/candidates/:id/message -- send a message to a candidate.
// Body: { partnerCompanyId, companyName, linkId (required for student
// candidates -- see capabilio-web's checkStudentAccessGate), subject, body }
router.post("/partner/candidates/:id/message", requireAuth, requireCompany, async (req, res) => {
  try {
    const data = await callPartnerBridge("POST", `candidates/${req.params.id}/message`, {
      body: {
        partnerCompanyId: req.companyId,
        companyName: req.companyName,
        linkId: req.body?.linkId,
        subject: req.body?.subject,
        body: req.body?.body,
      },
    });
    res.json(data);
  } catch (err) {
    console.error("[partner/candidates/:id/message]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/candidates/:id/messages?partnerCompanyId=X -- full thread.
router.get("/partner/candidates/:id/messages", requireAuth, requireCompany, async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", `candidates/${req.params.id}/messages`, { query: { partnerCompanyId: req.companyId } });
    res.json(data);
  } catch (err) {
    console.error("[partner/candidates/:id/messages]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/partner/candidates/:id/schedule -- schedule an interview call.
// Body: { partnerCompanyId, companyName, linkId (students only), scheduled_at,
// duration_mins, interview_type, meeting_link, title, description }
router.post("/partner/candidates/:id/schedule", requireAuth, requireCompany, async (req, res) => {
  try {
    const data = await callPartnerBridge("POST", `candidates/${req.params.id}/schedule`, {
      body: {
        partnerCompanyId: req.companyId,
        companyName: req.companyName,
        linkId: req.body?.linkId,
        scheduled_at: req.body?.scheduled_at,
        duration_mins: req.body?.duration_mins,
        interview_type: req.body?.interview_type,
        meeting_link: req.body?.meeting_link,
        title: req.body?.title,
        description: req.body?.description,
      },
    });
    res.json(data);
  } catch (err) {
    console.error("[partner/candidates/:id/schedule]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/candidates/:id/schedules?partnerCompanyId=X
router.get("/partner/candidates/:id/schedules", requireAuth, requireCompany, async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", `candidates/${req.params.id}/schedules`, { query: { partnerCompanyId: req.companyId } });
    res.json(data);
  } catch (err) {
    console.error("[partner/candidates/:id/schedules]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/candidates/by-username/:username -- resolve a
// capabilio_username (collected on the public apply form, see apply.js) to
// a real verified profile. Used by the recruiter-facing UI to show/refresh
// the "Verified Capabilio Profile" badge on an application; apply.js itself
// calls capabilio-web directly via ../lib/partnerBridge.js rather than this
// route, since apply.js has no recruiter session to satisfy requireAuth.
router.get("/partner/candidates/by-username/:username", requireAuth, async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", `candidates/by-username/${encodeURIComponent(req.params.username)}`);
    res.json(data);
  } catch (err) {
    console.error("[partner/candidates/by-username]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/institutions -- real list of colleges/institutions.
router.get("/partner/institutions", requireAuth, async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", "institutions");
    res.json(data);
  } catch (err) {
    console.error("[partner/institutions]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/company-invites?email=<recruiter's login email>
// 2026-08-09: email is now always the authenticated caller's own login
// email (req.user.email), never a client-supplied query param -- that
// previously let anyone read the pending invites addressed to ANY email
// address just by passing it in the URL.
router.get("/partner/company-invites", requireAuth, async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", "company-invites", { query: { email: req.user.email } });
    res.json(data);
  } catch (err) {
    console.error("[partner/company-invites]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/partner/company-invites/:id/accept
router.post("/partner/company-invites/:id/accept", requireAuth, requireCompany, async (req, res) => {
  try {
    const data = await callPartnerBridge("POST", `company-invites/${req.params.id}/accept`, {
      body: {
        partnerCompanyId: req.companyId,
        acceptedByEmail: req.user.email,
      },
    });
    res.json(data);
  } catch (err) {
    console.error("[partner/company-invites/accept]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/partner/company-invites/:id/decline
router.post("/partner/company-invites/:id/decline", requireAuth, async (req, res) => {
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
router.get("/partner/company-links", requireAuth, async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", "company-links", { query: { email: req.user.email } });
    res.json(data);
  } catch (err) {
    console.error("[partner/company-links]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/partner/company-links/:linkId/students -- aggregate, tier-scoped
// roster for one connected college.
router.get("/partner/company-links/:linkId/students", requireAuth, async (req, res) => {
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
router.post("/partner/company-links/:linkId/students/:studentId/request-access", requireAuth, requireCompany, async (req, res) => {
  try {
    const data = await callPartnerBridge(
      "POST",
      `company-links/${req.params.linkId}/students/${req.params.studentId}/request-access`,
      {
        body: {
          partnerCompanyId: req.companyId,
          requestedByEmail: req.user.email,
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
router.get("/partner/company-links/:linkId/access-requests", requireAuth, async (req, res) => {
  try {
    const data = await callPartnerBridge("GET", `company-links/${req.params.linkId}/access-requests`);
    res.json(data);
  } catch (err) {
    console.error("[partner/company-links/access-requests]", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
