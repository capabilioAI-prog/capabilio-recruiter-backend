const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars. " +
      "This backend uses the service-role key to bypass RLS (it is a " +
      "trusted server, equivalent to the recruiter's own company-scoped " +
      "access plus the ability to insert public job applications)."
  );
}

// Server-side client. Bypasses RLS by design (service role) -- every query
// in this codebase MUST explicitly filter by company_id / job_id itself,
// since Postgres will not do it for us here.
const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = { supabase };
