# Procurement Vendor Risk Monitor (n8n)

Continuous vendor risk monitoring built on [Parallel](https://parallel.ai)'s Task and Monitor APIs, orchestrated by n8n, with Slack-routed alerts and a cited audit log. Live demo: _video walkthrough coming with the public release_.

See [DEPLOY.md](DEPLOY.md) for the optional Next.js + Supabase dashboard that ships with the recipe.

## What it shows

- Driving the Parallel **Task Group** API from an n8n cron flow to research every vendor across six risk dimensions on a daily cadence.
- Deploying a portfolio of **V1 event-stream monitors** per vendor (sized to priority) and resolving events via `client.monitor.events`.
- Wiring monitor webhooks back into the same scoring chain that handles deep-research output, so live events and daily research share a code path.
- Lifting the top citation from `output.basis` so every alert and audit row carries a source URL.
- Severity-based routing into Slack (`#procurement-critical` / `#alerts` / `#digest`) plus a `/vendor-research` slash command for ad-hoc reports.

## Architecture

```
Google Sheets (Vendors tab)
        |
  Vendor Sync (every 6h) -----> Deploy Monitors (V1 event_stream)
        |                               |
  Deep Research (daily 2 AM)     Monitor Events (real-time webhooks)
        |                               |
        +--------> Risk Scoring <-------+
                      |
            Route by severity
           /     |      |     \
      CRITICAL  HIGH  MEDIUM  LOW
         |       |      |      |
      #critical #alerts #digest (log only)
                      |
                 Audit Log (with top_citation_url, confidence)
```

One combined n8n workflow contains all five flows (50 nodes total). Every Parallel API call — daily Task Group, per-vendor monitor create, event resolution — runs on the official [`parallel-web`](https://www.npmjs.com/package/parallel-web) SDK against the V1 surfaces.

## Quick Start

1. Clone the cookbook and enter the recipe.
   ```bash
   git clone https://github.com/parallel-web/parallel-cookbook.git
   cd parallel-cookbook/typescript-recipes/parallel-procurement-n8n
   ```
2. Install dependencies.
   ```bash
   npm ci
   ```
3. Copy `.env.example` to `.env` and fill in `PARALLEL_API_KEY`, `GOOGLE_SHEET_ID`, `SLACK_WEBHOOK_URL`, and `PROCUREMENT_SNAPSHOT_TOKEN`.
4. Run the test suite to verify the local install.
   ```bash
   npm test
   ```
5. Generate the importable n8n workflow JSON.
   ```bash
   npx tsx src/workflows/generate-all.ts ./n8n-workflows
   ```
6. Import `n8n-workflows/workflow-combined.json` into n8n Cloud, wire your Google Sheets and Slack credentials, and set `NODE_FUNCTION_ALLOW_EXTERNAL=parallel-web` so the Code nodes can `require()` the SDK at runtime. The full walkthrough is in [SETUP.md](SETUP.md).

Optional: the [`dashboard/`](dashboard/) folder is a Next.js + Supabase BYOK app that consumes the same Parallel APIs. See [DEPLOY.md](DEPLOY.md) for Vercel + Supabase setup.

## How it works

**Vendor sync diffs the source of truth, not the world.** The cron flow reads the Google Sheet, compares it to the persisted registry, and only deploys or cancels monitors where the row actually changed — so a re-run is cheap and idempotent. Monitor cancellation is irreversible per the V1 contract, so the self-healing path recreates a fresh monitor with the same settings rather than mutating in place.

**Daily research uses Task Groups, monitors stream events.** Each batch of due vendors becomes a Task Group of six per-dimension specs (financial, legal/regulatory, cybersecurity, leadership, ESG, adverse events). The same vendors also carry persistent V1 monitors (`type: "event_stream"`, nested `settings`, `processor: "lite" | "base"`) sized to priority: HIGH gets 5 monitors at `1d` cadence, MEDIUM gets 3 at `1d`, LOW gets 2 at `7d`. Cyber and legal monitors on HIGH vendors use the `base` processor for higher recall.

**Scoring is deterministic, citations are not.** The cascade is fixed (any CRITICAL → CRITICAL; any HIGH → HIGH; 3+ MEDIUM across 2+ categories → MEDIUM-adverse; otherwise MEDIUM or LOW), with overrides for active breaches, government litigation, and a spreadsheet `risk_tier_override` floor. The interesting part is what comes back from `output.basis`: every assessment carries reasoning, confidence, and citation URLs per field. The scorer groups basis entries by dimension, picks the highest-confidence citation per triggered dimension, and writes them as `top_citation_url` / `top_citation_title` / `confidence` on the audit row and as a `Sources:` block in the Slack alert.

**One workflow, five flows.** Combining the flows in a single n8n workflow means the monitor webhook and the daily Task Group fan into the exact same scoring chain — there is one risk-scoring path, not two that can drift. The five entry points (vendor sync cron, deep-research cron, monitor-deploy webhook, monitor-event webhook, Slack slash command) all share `src/services/risk-scorer.ts`.

For the data model, processor selection rationale, and a full walkthrough of the scoring overrides, see [`parallel_procurement.md`](parallel_procurement.md). For a 15-vendor sample run with screenshots, see [`sample-setup.md`](sample-setup.md).

## Configuration

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PARALLEL_API_KEY` | Yes | – | Parallel API key |
| `GOOGLE_SHEET_ID` | Yes | – | Google Sheets document ID |
| `SLACK_WEBHOOK_URL` | Yes | – | Slack incoming webhook |
| `PROCUREMENT_SNAPSHOT_TOKEN` | Yes | – | Bearer token for the snapshot endpoint (any 32+ char random string) |
| `N8N_WEBHOOK_BASE_URL` | Yes | – | Your n8n instance URL |
| `BATCH_SIZE` | No | `50` | Vendors per Task Group batch |
| `RESEARCH_PROCESSOR` | No | `ultra8x` | Parallel processor tier |
| `MONITOR_CADENCE_HIGH` / `_STD` | No | `1d` / `7d` | Override the default monitor cadences |
| `SLACK_CHANNEL_CRITICAL` / `_ALERT` / `_DIGEST` | No | see `.env.example` | Per-severity Slack routing |

The dashboard takes additional Supabase / encryption / webhook secrets; see [`dashboard/.env.example`](dashboard/.env.example) and [DEPLOY.md](DEPLOY.md).

## Tests

```bash
npm test
```

46 Vitest suites covering every service and model, n8n workflow JSON structure (combined + per-flow generators), full pipeline integration (research → score → route → audit), vendor lifecycle across sync cycles, nine error scenarios, and a scale simulation (200 vendors / 4 batches, 3000 vendors / 15-day rotation).

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Shapley AI, Inc.
