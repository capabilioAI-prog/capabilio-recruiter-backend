# capabilio-recruiter-backend

Node/Express backend for the Capabilio Recruiter app. Replaces the original
Railway-hosted backend, which is unrecoverable (source was never migrated
off the deleted Railway/GitHub accounts).

## Scope (current)

Implements the core application/screening flow only:

- `POST /api/apply/:jobId` — public, multipart resume upload. Parses the PDF,
  scores it against the job with Claude, uploads the PDF to Supabase Storage
  (`resumes` bucket), and inserts a row into `applications`.
- `POST /api/score-resume` — manual re-score, same scoring logic as above.
- `POST /api/generate-feedback` — Claude-drafted rejection feedback email.
- `POST /api/send-feedback` — sends the feedback email via Resend.

Deliberately **not** implemented yet (out of scope by design, see project
history): the fuller 6-layer AI screening pipeline (fraud signals, career
progression, churn risk, ELO estimation) that `ScreeningDashboard.jsx`
expects — that component isn't wired into any route in the frontend today,
so it wasn't rebuilt. If/when it's wanted, extend `applications` further and
add `GET /api/screening-stats/:jobId`, `PATCH /api/candidates/:id/override`,
`POST /api/feedback/bulk-send`.

Also **not** re-implemented here (still called directly from the browser,
which is a pre-existing exposed-API-key issue from the original migration,
not introduced by this rebuild): `JobBoard.jsx`, `OfferManagement.jsx`, and
`MessagingCenter.jsx` call `api.anthropic.com` directly. Those, plus the
`/api/recruiter/candidate-analysis`, `/generate-challenge`, `/team-chemistry`,
`/shadow-interview`, `/ai-match` endpoints hardcoded to the dead Railway URL
in several other pages, are follow-up work.

## Environment variables

See `.env.example`. Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `CORS_ORIGIN`.

## Local dev

```
npm install
cp .env.example .env   # fill in real values
npm start
```

## Deploy (Render)

- Build command: `npm install`
- Start command: `npm start`
- Root directory: (leave blank — `package.json` is at repo root)
