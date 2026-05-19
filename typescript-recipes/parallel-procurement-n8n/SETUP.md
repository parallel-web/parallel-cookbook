# Vendor Risk Monitoring System -- Setup Guide

Go from zero to a running vendor risk monitoring pipeline in ~30 minutes.

---

## 1. Prerequisites

You need three things before starting:

| # | What | Where to get it |
|---|------|-----------------|
| 1 | **Parallel AI API key** | [platform.parallel.ai/settings](https://platform.parallel.ai/settings) |
| 2 | **Google account** | Any Google account with Google Sheets access |
| 3 | **Slack workspace admin access** | Needed to create channels and a Slack app |

---

## 2. Google Sheets Setup (~5 minutes)

### Create the Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Name it **"Vendor Risk Registry"** (or any name you prefer)

### Import the CSV templates

For each CSV file in `templates/`, import it as a separate tab:

| File | Tab name |
|------|----------|
| `vendors-tab.csv` | **Vendors** |
| `registry-tab.csv` | **Registry** |
| `audit-log-tab.csv` | **Audit Log** |
| `monitors-tab.csv` | **Monitors** |

**How to import each CSV:**
1. In Google Sheets, click **File > Import**
2. Select **Upload** and choose the CSV file
3. Set **Import location** to **"Insert new sheet"**
4. Click **Import data**
5. Rename the tab to the name listed above

### Copy the Sheet ID

From the URL `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`, copy the `SHEET_ID_HERE` portion. You'll need this later.

### (Optional) Edit seed vendors

The **Vendors** tab comes pre-populated with 15 companies across technology, financial services, healthcare, manufacturing, and professional services. Edit these to match your actual vendor portfolio, or keep them to test the system first.

---

## 3. Slack Setup (~10 minutes)

### Create channels

Create these four channels in your Slack workspace:

| Channel | Purpose |
|---------|---------|
| `#procurement-critical` | CRITICAL/HIGH risk alerts (immediate) |
| `#procurement-alerts` | Standard risk notifications |
| `#procurement-digest` | Weekly digest summaries |
| `#vendor-risk-ops` | Ops notifications: health checks, run summaries, errors |

### Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, name it **"Vendor Risk Bot"**, select your workspace
3. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `chat:write`
   - `chat:write.public`
   - `commands`
   - `incoming-webhook`
4. Click **Install to Workspace** and authorize
5. Copy the **Bot User OAuth Token** (`xoxb-...`)

### Add the slash command

1. In your Slack App settings, go to **Slash Commands**
2. Click **Create New Command**:
   - **Command:** `/vendor-research`
   - **Request URL:** `https://YOUR_N8N_URL/webhook/vendor-research` (you'll fill this in after n8n setup)
   - **Short Description:** "Run ad-hoc vendor research"
   - **Usage Hint:** `[vendor name or domain]`
3. Click **Save**

### Copy credentials

Save these for the next step:
- **Bot User OAuth Token** (`xoxb-...`)
- **Webhook URL** for `#procurement-critical` (from Incoming Webhooks section)

---

## 4. n8n Setup (~10 minutes)

### Sign up or self-host

- **Cloud:** Sign up at [n8n.io](https://n8n.io) (free tier available)
- **Self-hosted:** Follow the [n8n self-hosting guide](https://docs.n8n.io/hosting/)

### Import workflows

1. In n8n, go to **Workflows**
2. For each JSON file in `n8n-workflows/`, click **Add Workflow > Import from File**:
   - `workflow1-vendor-sync.json` -- Vendor Sync (reads Vendors tab, writes to Registry)
   - `workflow2-deep-research.json` -- Deep Research (runs Parallel AI research on due vendors)
   - `workflow3-risk-scoring.json` -- Risk Scoring (scores research, routes to Slack, logs to Audit)
   - `workflow4-monitors.json` -- Monitors (manages Parallel AI monitor portfolio, handles events)
   - `workflow5-adhoc.json` -- Ad-Hoc Research (Slack `/vendor-research` command handler)

### Configure credentials

Set up these credential types in n8n (**Settings > Credentials**):

**Google Sheets (OAuth2):**
1. Click **Add Credential > Google Sheets OAuth2 API**
2. Follow the OAuth2 flow to connect your Google account
3. All Google Sheets nodes will use this credential

**HTTP Header Auth (for Parallel AI):**
1. Click **Add Credential > Header Auth**
2. Set **Name** to `x-api-key`
3. Set **Value** to your Parallel AI API key

**Slack (Bot Token):**
1. Click **Add Credential > Slack API**
2. Paste your Bot User OAuth Token (`xoxb-...`)

### Set environment variables

In n8n, go to **Settings > Variables** and add:

| Variable | Value | Description |
|----------|-------|-------------|
| `PARALLEL_API_KEY` | `your-api-key` | Parallel AI API key |
| `GOOGLE_SHEET_ID` | `your-sheet-id` | Google Sheet ID from step 2 |
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/...` | Slack incoming webhook URL |
| `N8N_WEBHOOK_BASE_URL` | `https://your-n8n.app.n8n.cloud` | Your n8n instance base URL |
| `SLACK_ALERT_TARGET` | `#procurement-critical` (optional) | Overrides the hardcoded Slack channel in the combined workflow |
| `RESEARCH_PROCESSOR` | `ultra8x` (optional) | Task API processor tier for daily research + ad-hoc runs |
| `PROCUREMENT_SNAPSHOT_TOKEN` | Required for the combined workflow | Shared token verified by the Snapshot region's Verify Token Function node. Without this, the `GET /webhook/procurement-dashboard-snapshot` endpoint refuses to run. Generate any random 32+ char string; the dashboard / any external caller must pass it as `?t=<token>` or in the `x-procurement-token` header. |

### Allow the parallel-web SDK in Code nodes (one-time)

Every Parallel call in the combined workflow is a `Code` node that does
`require('parallel-web')` against the official TypeScript SDK. n8n's Code
node sandbox blocks external `require()` calls by default — you have to
allowlist the module.

- **Self-hosted (Docker / bare metal):** set the env var on the n8n process,
  then restart:

  ```bash
  export NODE_FUNCTION_ALLOW_EXTERNAL=parallel-web
  ```

  If you already use this env var for other modules, append:
  `NODE_FUNCTION_ALLOW_EXTERNAL=parallel-web,axios,...`.

- **n8n Cloud:** the procurement template ships with `parallel-web`
  pre-allowlisted on the workspace. If you're importing into a workspace
  that hasn't been provisioned yet, contact n8n support to add it.

The TS reference services in `src/services/` use the same SDK via a normal
`import` — no special config needed for those (they don't run inside n8n).

### Wire Execute Workflow nodes

Some workflows call other workflows. After importing, update the **Execute Workflow** nodes:

1. In **Workflow 2 (Deep Research)**, find the Execute Workflow node that calls Risk Scoring -- set it to reference **Workflow 3**'s ID
2. In **Workflow 4 (Monitors)**, find the Execute Workflow node that calls Risk Scoring -- set it to reference **Workflow 3**'s ID

To find a workflow's ID: open it in n8n, and copy the ID from the URL (`https://your-n8n.app.n8n.cloud/workflow/WORKFLOW_ID`).

### Update Slack slash command URL

1. Copy the webhook URL from **Workflow 5 (Ad-Hoc)** -- visible when you activate it
2. Go back to your [Slack App settings](https://api.slack.com/apps) > **Slash Commands**
3. Edit `/vendor-research` and set the **Request URL** to the n8n webhook URL

---

## 5. Activate & Test (~5 minutes)

### Step-by-step activation

**1. Test Vendor Sync (Workflow 1)**
- Open Workflow 1 and click **Execute Workflow** (manual run)
- Check that the **Registry** tab in Google Sheets now has rows matching your Vendors tab
- Activate the workflow (toggle on)

**2. Test Deep Research (Workflow 2)**
- Open Workflow 2 and click **Execute Workflow**
- Watch the Parallel AI dashboard for task activity
- After completion, check `#procurement-alerts` or `#procurement-critical` in Slack for alerts
- Check the **Audit Log** tab in Google Sheets for entries
- Activate the workflow

**3. Test Monitors (Workflow 4)**
- Open Workflow 4 and trigger manually
- Check the Parallel AI dashboard -- monitors should appear for your vendors
- Check the **Monitors** tab in Google Sheets for tracking entries
- Activate the workflow

**4. Test Ad-Hoc Research (Workflow 5)**
- Activate Workflow 5
- In Slack, type `/vendor-research microsoft.com`
- You should receive a research report back in the channel

**5. Activate remaining workflows**
- Activate Workflow 3 (Risk Scoring) -- this is called by other workflows, not on a cron
- Verify all 5 workflows show as active

### Default schedules

| Workflow | Schedule |
|----------|----------|
| 1. Vendor Sync | Every 6 hours |
| 2. Deep Research | Daily at 2:00 AM UTC |
| 4. Monitors | Cron: health check daily at 6:00 AM UTC |
| 5. Ad-Hoc | Webhook (always listening) |

---

## 6. Configuration Reference

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PARALLEL_API_KEY` | Yes | -- | Your Parallel AI API key |
| `GOOGLE_SHEET_ID` | Yes | -- | ID of the Google Sheet with all tabs |
| `SLACK_WEBHOOK_URL` | Yes | -- | Slack incoming webhook for critical alerts |
| `N8N_WEBHOOK_BASE_URL` | Yes | -- | Base URL of your n8n instance |
| `RESEARCH_CYCLE_DAYS` | No | `7` | Days between research runs per vendor |
| `BATCH_SIZE` | No | `10` | Vendors per Parallel AI task group |
| `POLL_INTERVAL_MS` | No | `60000` | Task group polling interval (ms) |
| `POLL_TIMEOUT_MS` | No | `3600000` | Task group polling timeout (ms) |

### Monitor portfolio strategy (V1)

Each vendor gets `type: "event_stream"` monitors across these risk
dimensions. The V1 `frequency` field replaces the old "daily"/"weekly"
cadence labels.

| Dimension | Monitor Category | Frequency |
|-----------|-----------------|-----------|
| Financial Health | `Financial Health` | `1d` (HIGH/MEDIUM) / `7d` (LOW) |
| Legal & Regulatory | `Legal & Regulatory` | `1d` (HIGH/MEDIUM) / `7d` (LOW) |
| Cybersecurity | `Cybersecurity` | `1d` (HIGH/MEDIUM) |
| Leadership & Governance | `Leadership & Governance` | `1d` (HIGH only) |
| ESG & Reputation | `ESG & Reputation` | `1d` (HIGH only) |

**Priority-based allocation:**
- **High priority** vendors: All 5 dimensions monitored, daily.
- **Medium priority** vendors: Legal, Cyber, Financial (3 dimensions), daily.
- **Low priority** vendors: Legal, Financial (2 dimensions), weekly.

**Processor tier:** the workflow uses `processor: "base"` for HIGH-priority
Cyber and Legal monitors (where higher recall earns its cost) and
`processor: "lite"` everywhere else (cheaper, faster, fine for the
remaining queries). See the V1
[Monitor Migration Guide](https://docs.parallel.ai/monitor-api/monitor-migration-guide)
for the full processor schedule.

### Risk scoring rules

| Risk Level | Trigger | Slack Channel |
|------------|---------|---------------|
| **CRITICAL** | Any critical-severity finding OR risk_tier_override = CRITICAL | `#procurement-critical` (immediate) |
| **HIGH** | 2+ high-severity findings OR any adverse event | `#procurement-critical` (immediate) |
| **MEDIUM** | 1 high-severity OR 3+ medium-severity findings | `#procurement-digest` (batched) |
| **LOW** | All other cases | No alert (logged only) |

### Slack channel routing

| Channel | What gets posted |
|---------|-----------------|
| `#procurement-critical` | CRITICAL and HIGH risk alerts with full detail |
| `#procurement-alerts` | Standard notifications and status updates |
| `#procurement-digest` | Weekly aggregated risk digest |
| `#vendor-risk-ops` | Health check reports, run summaries, error notifications |
