# Supabase setup

The dashboard uses Supabase **only as a Postgres database**. Authentication is
handled by the application via Parallel OAuth (PKCE) — Supabase Auth is not
exposed to end users.

## One-time setup

1. Create a new project at [supabase.com](https://supabase.com).
2. Apply the schema:

   ```bash
   psql "$SUPABASE_DB_URL" -f supabase/schema.sql
   ```

   or paste the contents of `schema.sql` into the SQL editor in the Supabase
   dashboard.

3. From **Project Settings → API**, copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only, never sent
     to the browser)

4. Set the env vars locally (`.env.local`) and on Vercel.

## Multi-tenancy model

- Every table is scoped by `account_id` and protected by Row Level Security.
- The application's server-side request handlers use the **service-role key**
  to bypass RLS, but always include `account_id = ?` filters in queries
  derived from the authenticated session.
- The helper `withAccount()` in `lib/server/db.ts` wraps every authenticated
  request and validates the session cookie before running the callback.
