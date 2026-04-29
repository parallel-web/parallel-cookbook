# Parallel n8n Procurement Setup

This guide gets the combined vendor-risk workflow running in n8n with Google Sheets and Slack.

## 1. Prerequisites

You need:

| Requirement | Purpose |
| --- | --- |
| Parallel API key | Runs research tasks and monitor operations |
| n8n Cloud or self-hosted n8n | Hosts the workflow |
| Google account | Stores vendor registry, monitor records, and audit logs |
| Slack workspace admin access | Creates alert channels and the slash command |
| Node.js 20+ | Validates and regenerates workflow JSON locally |

## 2. Validate the Recipe Locally

```bash
npm ci
npm run check
npm test
npm run generate:workflows
```

`npm run generate:workflows` rebuilds the JSON files in `n8n-workflows/` from the TypeScript workflow generators.

## 3. Create the Google Sheet

Create a spreadsheet named `Vendor Risk Registry`, then import each file in `templates/` as a separate tab:

| File | Tab name |
| --- | --- |
| `vendors-tab.csv` | `Vendors` |
| `registry-tab.csv` | `Registry` |
| `audit-log-tab.csv` | `Audit Log` |
| `monitors-tab.csv` | `Monitors` |

Copy the spreadsheet ID from the URL:

```text
https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
```

The `Vendors` tab includes sample vendors. Replace them with your own vendors or keep them for a first test run.

## 4. Prepare Slack

Create these channels:

| Channel | Purpose |
| --- | --- |
| `#procurement-critical` | Critical and high-severity alerts |
| `#procurement-alerts` | Standard monitor and research notifications |
| `#procurement-digest` | Batched medium-severity findings |
| `#vendor-risk-ops` | Workflow health and run summaries |

Create a Slack app with these bot scopes:

- `chat:write`
- `chat:write.public`
- `commands`
- `incoming-webhook`

Install the app to your workspace and keep the bot token. Add a slash command:

| Field | Value |
| --- | --- |
| Command | `/vendor-research` |
| Request URL | `https://YOUR_N8N_HOST/webhook/slack-command` |
| Short description | `Run ad-hoc vendor research` |
| Usage hint | `[vendor name or domain]` |

You can update the request URL after importing and activating the workflow if your n8n webhook URL differs.

## 5. Import the n8n Workflow

In n8n, import only this file for the normal setup:

```text
n8n-workflows/workflow-combined.json
```

This is the canonical workflow. It has 48 nodes, 42 connections, and no `executeWorkflow` nodes, so there is no separate workflow-ID wiring step.

The other workflow JSON files are included for advanced users who want to inspect or split the system.

## 6. Configure Credentials and Variables

In n8n, configure these credentials:

| Credential | Used by |
| --- | --- |
| Google Sheets OAuth2 | All Google Sheets nodes |
| Slack API bot token | Slack message and slash-command response nodes |
| HTTP Header Auth, if requested by n8n | HTTP Request nodes that call Parallel APIs |

Set these n8n variables:

| Variable | Required | Example |
| --- | --- | --- |
| `PARALLEL_API_KEY` | Yes | `pws_...` |
| `GOOGLE_SHEET_ID` | Yes | `1abc...xyz` |
| `SLACK_WEBHOOK_URL` | Yes | `https://hooks.slack.com/services/...` |
| `N8N_WEBHOOK_BASE_URL` | Yes | `https://your-workspace.app.n8n.cloud` |
| `SLACK_ALERT_TARGET` | No | `#procurement-critical` |

Use `N8N_WEBHOOK_BASE_URL` without a trailing slash. The workflow builds callback URLs such as:

```text
https://your-workspace.app.n8n.cloud/webhook/parallel-task-completion
```

If n8n prompts for an HTTP Header Auth credential, set the header name to `x-api-key` and the value to your Parallel API key.

## 7. Activate and Test

Run these tests in order:

1. Execute `Sync: Manual Trigger`.
2. Confirm the `Registry` tab is populated from the `Vendors` tab.
3. Confirm monitor records are created in the `Monitors` tab.
4. Execute `Research: Manual Trigger`.
5. Confirm the `Audit Log` tab receives a scored assessment.
6. Confirm Slack receives alerts for HIGH or CRITICAL findings.
7. Activate the workflow.
8. In Slack, run `/vendor-research microsoft.com`.

The scheduled triggers run vendor sync and research automatically after activation.

## 8. Troubleshooting

| Symptom | Check |
| --- | --- |
| Google Sheets nodes fail | Confirm the imported tab names match exactly: `Vendors`, `Registry`, `Audit Log`, `Monitors` |
| Parallel calls fail | Confirm `PARALLEL_API_KEY` is set in n8n variables and any HTTP Header Auth credential |
| Slack messages fail | Confirm the Slack app is installed, the bot token credential is selected, and the bot is in the target channels |
| Slash command times out | Confirm the Slack request URL points to the active n8n webhook path |
| Task callbacks do not arrive | Confirm `N8N_WEBHOOK_BASE_URL` is public and has no trailing slash |

## 9. Keeping Workflow JSON in Sync

When changing workflow generator code:

```bash
npm run generate:workflows
npm run check
npm test
```

Commit both the TypeScript generator changes and the regenerated JSON files.
