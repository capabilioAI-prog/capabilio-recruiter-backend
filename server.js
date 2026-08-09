require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const applyRoute = require("./src/routes/apply");
const scoreResumeRoute = require("./src/routes/scoreResumeRoute");
const feedbackRoutes = require("./src/routes/feedback");
const offersRoutes = require("./src/routes/offers");
const partnerBridgeRoutes = require("./src/routes/partnerBridge");
const candidateTasksRoutes = require("./src/routes/candidateTasks");
const tasksRoutes = require("./src/routes/tasks");
const searchAssistRoutes = require("./src/routes/searchAssist");
const hiringAssistantRoutes = require("./src/routes/hiringAssistant");
const workflowRoutes = require("./src/routes/workflow");
const messageDraftRoutes = require("./src/routes/messageDraft");
const bulkRejectRoutes = require("./src/routes/bulkReject");

const app = express();

// Trust Render's proxy so req.ip / rate limiting (if added later) sees the
// real client address.
app.set("trust proxy", 1);

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow no-origin requests (curl, server-to-server health checks).
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  })
);

// express.json() only engages for application/json bodies, so it's safe to
// mount globally even though /apply/:jobId uses multipart/form-data.
app.use(express.json({ limit: "1mb" }));

// 2026-08-09 production-hardening: no rate limiting existed anywhere on
// this service. A baseline limit on every /api route, plus a much
// stricter one on /apply/:jobId specifically -- it's the one route that
// MUST stay unauthenticated (public job application form) and is also the
// most expensive per-call (PDF parsing + an AI scoring call + a file
// upload), so it's the most attractive target for abuse/DoS. A real
// candidate applying to a job submits once, maybe twice if they made a
// mistake -- 5 per 15 minutes per IP is generous for that, not for a script.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});
const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many applications submitted from this network. Please try again later." },
});
app.use("/api", apiLimiter);
app.use("/api/apply", applyLimiter);

app.get("/", (req, res) => {
  res.json({ ok: true, service: "capabilio-recruiter-backend" });
});
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api", applyRoute);
app.use("/api", scoreResumeRoute);
app.use("/api", feedbackRoutes);
app.use("/api", offersRoutes);
app.use("/api", partnerBridgeRoutes);
app.use("/api", candidateTasksRoutes);
app.use("/api", tasksRoutes);
app.use("/api", searchAssistRoutes);
app.use("/api", hiringAssistantRoutes);
app.use("/api", workflowRoutes);
app.use("/api", messageDraftRoutes);
app.use("/api", bulkRejectRoutes);

// 404 for anything unmatched under /api
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler -- catches multer errors (file too large / wrong
// type) and anything else thrown/rejected in a route. Every route above
// is async; Express 4 does not auto-catch rejected promises, so make sure
// each route's own try/catch responds, and this is the backstop for
// anything that slips through (e.g. multer's own errors thrown before a
// route handler even runs).
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  if (err.message && err.message.includes("PDF")) {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Resume must be under 5MB." });
  }
  res.status(500).json({ error: "Internal server error." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`capabilio-recruiter-backend listening on :${PORT}`);
});

// Never let an unhandled rejection or exception silently kill the process
// without a log line -- Render restarts the service either way, but this
// makes the cause visible in logs instead of a bare crash.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
