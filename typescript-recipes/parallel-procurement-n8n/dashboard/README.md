# Parallel Procurement Dashboard

Multi-tenant **BYOK gateway** for continuous vendor risk monitoring on top of
the [Parallel.ai](https://parallel.ai) Task and Monitor APIs.

The dashboard never holds a managed Parallel / Slack / Resend key. Each user
brings their own at sign-in (and on **Settings → API keys**); those keys are
AES-GCM encrypted at rest in Supabase and only ever decrypted server-side at
the moment of use.

- **Sign in** is paste-key only: provide an email + your Parallel API key.
  We validate the key against the Parallel API before creating the account.
- **Slack alerts** (HIGH / CRITICAL) use a Slack bot token you provide.
- **Email alerts** use a Resend API key you provide.
- **Multi-tenancy**: Postgres RLS keyed to a per-request `app.account_id` GUC.

## Local development

1. **Install deps**

   ```bash
   cd typescript-recipes/parallel-procurement-n8n/dashboard
   npm install
   ```

2. **Provision Supabase**

   Create a Supabase project, then apply the schema (idempotent):

   ```bash
   psql "$SUPABASE_DB_URL" -f supabase/schema.sql
   ```

3. **Configure env vars**

   Copy `.env.example` to `.env.local` and fill in values:

   - `NEXT_PUBLIC_APP_URL` — public URL of the deployment.
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — from Project Settings → API.
   - `SESSION_SECRET` — `openssl rand -base64 32`.
   - `APP_ENCRYPTION_KEY` — `openssl rand -hex 32` (must decode to 32 bytes).
   - `PARALLEL_WEBHOOK_SECRET` — any 32+ char random string.
   - `CRON_SECRET` — bearer auth required for scheduled and manual cron triggers.

   No Parallel / Slack / Resend keys are configured at the platform level.
   Every user provides their own.

4. **Run**

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000` → `/signin` → paste email + Parallel API key
   → land on `/onboarding/profile`.

## Deploying to Vercel

1. Push the repo and import this `dashboard/` directory as a Vercel project
   (or use `vercel --cwd typescript-recipes/parallel-procurement-n8n/dashboard`).
2. Set every env var from the list above in Vercel **Project Settings → Env
   Vars** (Production + Preview).
3. Vercel will read `vercel.json` and schedule:
   - `/api/cron/sweep` daily at 05:00 UTC — refreshes any in-flight task
     groups and reconciles runs that finished without delivering a webhook.
     (Hobby tier is limited to one cron per day; upgrade to Pro to switch
     this back to hourly `0 * * * *`.)
   - `/api/cron/research-due` daily at 06:00 UTC — kicks off fresh research
     for any vendor whose `next_research_date` has elapsed, using each
     account's BYOK Parallel key.

## Smoke test

After deploying:

1. Visit `/signin` → paste email + Parallel API key → continue.
2. Onboarding step 1: enter a display name.
3. Onboarding step 2: paste two vendors, e.g.

   ```
   Microsoft, microsoft.com, technology, high
   Oracle, oracle.com, technology, medium
   ```

4. Onboarding step 3: hit **Start research**. Progress polls
   `/api/research/groups/<id>` every 5 s. Once done, monitors deploy and you
   land on `/`.
5. Visit **Settings → API keys**:
   - Parallel shows your initial key, marked default.
   - Add a Slack bot token (with `chat:write` scope) and a channel.
   - Add a Resend API key and a verified `from` address.
   - Use **Validate** to confirm each key, **Send test** to fire a real
     test message / email.
6. Trigger a HIGH or CRITICAL assessment (manually re-run research on a
   vendor known to have adverse signals) and watch Slack + email fire.

## How it fits together

```
Browser ──► Next.js (App Router) ──► /api/auth/key (paste key)
                │                       │
                │                       ▼
                ├──► Supabase Postgres (RLS, integrations.encrypted_secret)
                │
                ├──► api.parallel.ai     (using user's Parallel key)
                ├──► slack.com/api/*     (using user's Slack token)
                └──► api.resend.com/*    (using user's Resend key)
                          │
                          ▼
                Webhook ──► /api/webhooks/parallel-task
                          ──► /api/webhooks/parallel-monitor
                                  └──► notifyAssessment fans out
                                       to Slack + email integrations
```

- `lib/server/db.ts` — service-role Supabase client (server-only).
- `lib/server/account.ts` — `requireAccount` / `requireAccountWithKey`.
- `lib/server/integrations.ts` — BYOK CRUD + decrypt + audit.
- `lib/server/providers.ts` — per-provider validate / test / send helpers
  (Parallel, Slack, Resend).
- `lib/server/notifications.ts` — Slack + email alert fan-out.
- `lib/server/research.ts` — kicks off Parallel deep research, persists
  pending `risk_assessments`, scores results, then notifies on HIGH+.
- `lib/server/monitors.ts` — deploys per-priority monitor portfolios via
  the Parallel Monitor API.
- `lib/parallel/*` — pure Parallel API clients, prompt + monitor query
  generators, and risk scorer.
- `app/settings/keys/` — full settings UI (list, add, validate, send test,
  rotate, delete) for all three providers.
- `app/api/integrations/*` — REST surface backing the settings UI.

## Where the n8n project still fits

The sibling [`../src/`](../src/) and [`../n8n-workflows/`](../n8n-workflows/)
directories are the original n8n deploy path. Nothing in this dashboard
depends on n8n at runtime; the pure parts of the integration are
re-implemented in TypeScript so they run inside Next.js. Run either side
independently, or run both against the same Parallel account.
