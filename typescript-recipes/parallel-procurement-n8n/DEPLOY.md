# Deploying the dashboard

The recipe ships two deployable pieces:

1. The **n8n workflow JSON** in [`n8n-workflows/`](n8n-workflows/) — import into n8n Cloud (or a self-hosted instance). The full walkthrough is in [SETUP.md](SETUP.md).
2. The optional **Next.js + Supabase dashboard** in [`dashboard/`](dashboard/) — a multi-tenant BYOK control plane that uses the same Parallel APIs the n8n flow does.

This document covers the dashboard. For the n8n side, see SETUP.md.

## One-click Vercel deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fparallel-web%2Fparallel-cookbook%2Ftree%2Fmain%2Ftypescript-recipes%2Fparallel-procurement-n8n%2Fdashboard&project-name=parallel-procurement-dashboard&repository-name=parallel-procurement-dashboard)

The Vercel project should target the `dashboard/` subdirectory. The full step-by-step (Supabase provisioning, env vars, cron schedule, smoke test) lives in [`dashboard/README.md`](dashboard/README.md#deploying-to-vercel).

## Required environment variables

All values live in Vercel **Project Settings → Env Vars** (Production + Preview). No Parallel, Slack, or Resend keys are configured at the platform level — every user brings their own at sign-in.

| Variable | How to generate |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public URL of the deployment |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase **Project Settings → API** |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `APP_ENCRYPTION_KEY` | `openssl rand -hex 32` (must decode to 32 bytes) |
| `PARALLEL_WEBHOOK_SECRET` | Any 32+ char random string |
| `CRON_SECRET` | Bearer auth required by `/api/cron/*` endpoints |

See [`dashboard/.env.example`](dashboard/.env.example) for the full list and inline notes.

## What the cron jobs do

`dashboard/vercel.json` schedules:

- `/api/cron/sweep` (daily 05:00 UTC) — reconciles in-flight task groups whose webhooks were dropped.
- `/api/cron/research-due` (daily 06:00 UTC) — runs deep research for any vendor whose `next_research_date` has elapsed, using each account's BYOK Parallel key.

Vercel Hobby is limited to one cron per day per project; upgrade to Pro if you want the hourly sweep cadence noted in the dashboard README.
