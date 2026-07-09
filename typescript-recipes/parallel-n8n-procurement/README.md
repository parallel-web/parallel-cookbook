# Parallel n8n Procurement

Vendor risk monitoring with Parallel Tasks, Parallel Monitors, n8n, Google Sheets, and Slack.

This recipe turns a vendor spreadsheet into an automated procurement intelligence pipeline. It researches vendors on a schedule, deploys persistent monitors for breaking events, scores findings with deterministic rules, routes alerts to Slack, and writes an audit trail back to Google Sheets.

## What It Demonstrates

- Parallel Task API for scheduled vendor due diligence
- Parallel Monitor API for ongoing vendor event detection
- A single importable n8n workflow with no cross-workflow ID wiring
- Google Sheets as the vendor registry and audit log
- Slack alerts, digests, operations reports, and ad-hoc slash-command research
- A live Next.js dashboard for portfolio triage, add/upload/reset write-back, feeds, and Observe topology review
- TypeScript workflow generators and tests for repeatable n8n JSON output

## Quick Start

```bash
npm ci
npm run check
npm test
npm run generate:workflows
```

Import `n8n-workflows/workflow-combined.json` into n8n. Then point the dashboard app at the combined workflow's `procurement-dashboard-snapshot` and `procurement-portfolio-mutation` webhooks. See [SETUP.md](SETUP.md) for the full setup path.

## How It Works

```text
Google Sheets Vendors tab
        |
        v
Vendor Sync every 6h  ----->  Deploy vendor monitors
        |                              |
        v                              v
Deep Research daily 2 AM        Monitor event webhooks
        |                              |
        +-----------> Risk Scoring <---+
                         |
                         v
              Slack routing + Audit Log
                         |
                         v
              Dashboard snapshot webhook

Dashboard portfolio add/upload/reset
        |
        v
Portfolio mutation webhook
        |
        v
Google Sheets Vendors + Registry tabs
```

The combined n8n workflow contains 56 nodes, 49 connections, 6 webhook triggers, 2 schedule triggers, and zero `executeWorkflow` or `executeWorkflowTrigger` nodes. That means it can be imported as one workflow without manually wiring workflow IDs after import.

### Vendor Sync

The workflow reads the `Vendors` and `Registry` tabs from Google Sheets, computes additions, removals, and priority changes, then creates or deletes monitor records as needed.

### Deep Research

Scheduled research builds vendor risk prompts and submits Parallel research tasks. Results are normalized, scored, routed, and logged.

### Continuous Monitoring

Each active vendor gets monitors based on priority. High-priority vendors get broader daily coverage; lower-priority vendors get a smaller set of monitor queries. Monitor events are enriched, deduplicated, scored, and routed through the same alerting path as scheduled research.

### Ad-Hoc Research

A Slack slash command can trigger a one-off vendor assessment. The workflow acknowledges the command immediately, starts a Parallel research task, then posts the scored result back to Slack when the callback arrives.

### Dashboard

The `dashboard/` directory contains the full Next.js procurement dashboard. It is live-data only: runtime pages require `PROCUREMENT_DASHBOARD_SNAPSHOT_URL`, which should point to the combined workflow's `procurement-dashboard-snapshot` webhook. Portfolio add/upload/reset requires `PROCUREMENT_DASHBOARD_MUTATION_URL` plus `PROCUREMENT_DASHBOARD_WRITE_TOKEN`; the dashboard sends the token to n8n as `x-procurement-dashboard-token`, and n8n validates it against its `PROCUREMENT_DASHBOARD_WRITE_TOKEN` variable before writing to Google Sheets. The dashboard includes overview, attention queue, portfolio manager, feed, Observe topology, and vendor detail pages.

## Primary Workflow

Use this file for normal deployments:

| File | Purpose |
| --- | --- |
| `n8n-workflows/workflow-combined.json` | Canonical single-import workflow for n8n Cloud or self-hosted n8n |

The individual workflow files are included as advanced references for teams that want to inspect or split the pipeline:

| File | Purpose |
| --- | --- |
| `workflow1-vendor-sync.json` | Vendor registry diff and monitor lifecycle |
| `workflow2-deep-research.json` | Scheduled vendor research |
| `workflow3-risk-scoring.json` | Shared scoring and routing logic |
| `workflow4-monitors.json` | Monitor deployment and event handling |
| `workflow5-adhoc.json` | Slack slash-command research |

## Required Inputs

Set the n8n variables and dashboard runtime env vars as applicable:

| Variable | Description |
| --- | --- |
| `PARALLEL_API_KEY` | Parallel API key |
| `GOOGLE_SHEET_ID` | Google Sheet ID that contains the vendor registry tabs |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |
| `N8N_WEBHOOK_BASE_URL` | Public base URL for the n8n instance |
| `PROCUREMENT_DASHBOARD_SNAPSHOT_URL` | Dashboard runtime URL for the n8n `procurement-dashboard-snapshot` webhook |
| `PROCUREMENT_DASHBOARD_MUTATION_URL` | Dashboard runtime URL for the n8n `procurement-portfolio-mutation` webhook |
| `PROCUREMENT_DASHBOARD_WRITE_TOKEN` | Shared secret set in both dashboard runtime and n8n variables for portfolio write-back |

Optional settings are documented in [.env.example](.env.example).

## Google Sheets Tabs

Import the CSV files in `templates/` as these tabs:

| CSV | Tab name |
| --- | --- |
| `vendors-tab.csv` | `Vendors` |
| `registry-tab.csv` | `Registry` |
| `audit-log-tab.csv` | `Audit Log` |
| `monitors-tab.csv` | `Monitors` |

The seed vendor file includes 15 sample vendors so the pipeline can be tested immediately.

## Project Structure

```text
parallel-n8n-procurement/
  dashboard/            Live Next.js portfolio and Observe dashboard
  n8n-workflows/        Importable n8n workflow JSON
  templates/            Google Sheets CSV tab templates
  src/
    config/             Environment validation
    models/             TypeScript models and API shapes
    services/           Risk scoring, research orchestration, Slack, monitors
    workflows/          n8n workflow generators
  tests/                Unit, workflow, integration, and scale tests
  SETUP.md              Step-by-step deployment guide
  parallel_procurement.md
  sample-setup.md
```

## Validation

The recipe includes tests for the service layer, model validation, workflow generation, integration scenarios, and scale simulations.

```bash
npm run check
npm test
npm run generate:workflows
```

Dashboard validation:

```bash
cd dashboard
npm ci
npm run check
npm run build
npm run test:e2e
```

Expected current baseline:

- `npm run check` passes with `tsc --noEmit`
- `npm test` passes with 566 tests
- `npm run generate:workflows` regenerates the committed workflow JSON files
- Dashboard `npm run check`, `npm run build`, and `npm run test:e2e` pass with mocked snapshot and mutation endpoints

## Notes

- The workflow JSON uses placeholder credentials and n8n variables. Do not commit real API keys, Slack tokens, webhook secrets, or Google credentials.
- `workflow-combined.json` is the supported import path. The split workflow files are for reference and advanced customization.
- The dashboard uses local mocked snapshot and mutation endpoints only in Playwright tests. Runtime app code has no mock fallback.
- Portfolio add/upload/reset writes to `Vendors` and `Registry`. Monitor creation and deletion still happen when the existing sync path runs.
