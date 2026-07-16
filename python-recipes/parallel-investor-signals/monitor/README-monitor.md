# Investor Signals: the monitoring pipeline

**Goal:** flag every time a fund on *your* watchlist backs an AI-native company at seed–Series B, so your team can get ahead of the round. ([Full project context](../README.md).)

Set your watchlist first, copy `investors.example.json` to `investors.json` and list the funds you care about (see the [top-level README](../README.md#1-choose-the-funds-you-track)).

This pipeline uses the two Parallel APIs **together, not either alone**:

| Layer | API | Why |
|---|---|---|
| **Bootstrap** (history) | Task API | Monitors only track forward from creation, the first exhaustive search of the last 60 days is a Task job |
| **Detect** (continuous) | Monitor API | One `event_stream` monitor per fund, daily, `lite`, cheap wide detection with structured output + citations |
| **Verify** (per event) | Task API, chained | Each event's `event_id` is passed as `previous_interaction_id` to a follow-up Task that confirms fund/stage/AI-nativeness with citations, the precision gate that prevents alert fatigue |

## Files

```
monitor/
├── config.py                     # watchlist loader, queries, schemas, processors, the tuning surface
├── investors.example.json        # sample watchlist, copy to investors.json (gitignored) and make it yours
├── common.py                     # Parallel client, portco dedupe, signal store, task runner
├── sweep.py                      # bootstrap: exhaustive Task sweep (last 60 days per fund)
├── monitors.py                   # create | list | trigger | cancel the per-fund monitors
├── check.py                      # drain new events → chained verification → signals.json
├── build_portfolio.py            # derive the names-only known-companies list from any CSV export
├── portfolio_names.example.json  # fictional fixture (your real list is generated + gitignored)
└── signals.json                  # OUTPUT: qualified, cited signals (gitignored, generated)
```

`investors.json`, `data/` (raw CRM exports), and the derived `portfolio_names.json` are all **gitignored**: only fictional example fixtures are committed. Your target funds and CRM are yours; nothing about them ships in git.

## Run it

```bash
source project/backend/.venv/bin/activate
python monitor/sweep.py             # once: backfill history, seed signals.json
python monitor/monitors.py create   # once: start one daily monitor per fund
python monitor/check.py             # any cadence: drain + verify new events
python monitor/monitors.py trigger  # optional: force a run now (then check.py)
```

`check.py` is the recurring entry point, run it manually, via cron, or wire it to a scheduler. Each signal in `signals.json` carries: company, stage, amount, date, investors, AI-native one-liner, **source URLs**, whether it's already on your known-companies list, and the run/event IDs for provenance.

## Design decisions

- **One monitor per fund**, not one broad query, scoped intent-heavy queries perform better, `metadata.fund` routes events, and cadence/processor tune per fund.
- **Known companies are labeled, never suppressed**: a new round in a company you already know is still a signal; only live pipeline status (e.g. an Attio lookup) should suppress it.
- **Polling or webhooks**: `check.py` drains events on demand (zero public-endpoint complexity), or point the monitors at the deployed `/api/monitor/webhook` receiver for real-time push. Same verification chain either way.
- **Verification defaults on** (`check.py --raw` to skip): detection is optimized for recall, the chained Task run is optimized for precision. Alert quality is the product.

## Slack delivery

Delivery is a standard Slack incoming webhook + [Block Kit](https://api.slack.com/block-kit). `investor_core.post_to_slack` quietly no-ops when `SLACK_WEBHOOK_URL` is unset, so the pipeline runs fine without Slack, nothing breaks, signals still land in `signals.json`.

House style, all in `build_signal_blocks`:

- Emoji header by priority, 🚨 high / 🔔 medium / 🗞 digest
- A `•`-separated context line, then one labeled `section` per field
- A warm-intro-path section (intro via the investing partner)
- `📎 Sources:` numbered links, capped at 5

There are two delivery paths:

- **Weekly digest**: one message on a schedule (Vercel Cron hits `/api/signals/weekly-digest`), rolling up the week's qualifying rounds.
- **Real-time webhook**: Parallel calls `/api/monitor/webhook` on `monitor.event.detected`; the FastAPI receiver parses the event → runs the chained verification Task → applies the priority gate → posts to Slack. `metadata.fund` routes the event; digest-priority events don't ping.

Enable end-to-end push (no cron, no polling):

```bash
# 1. Add SLACK_WEBHOOK_URL (and optionally WEBHOOK_SECRET) to .env + your host env
# 2. Point the monitors at the deployed receiver:
python monitor/monitors.py set-webhook https://<your-app>.vercel.app
# From then on: monitor fires → host verifies via chained Task → Slack ping.
```

Test formatting anytime: `python monitor/slack_notify.py --preview` (dry-run) / `--send`.

## Extending it

Natural next steps, none required to run the pipeline:

1. **Live CRM check**: replace the names-list label with a real "in pipeline?" lookup (an `ATTIO_API_KEY` wires this up today) and suppress or re-route accordingly.
2. **Full enrichment per signal**: auto-run the app's `ResearchBrief` for each new company so contacts + buying signals are ready before anyone opens the app.
3. **Feedback loop**: log ✅/❌ Slack reactions against signals to tune the qualification prompt.
4. **Curated key sources**: additional monitors with `source_policy.include_domains` for authority-weighted detection.
