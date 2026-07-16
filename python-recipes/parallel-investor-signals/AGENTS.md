# AGENTS.md: onboarding for a coding agent

> **How to use this file.** Paste its contents (or point your agent at it) from a fresh
> clone of this recipe. It tells the agent what the project is, the invariants it must not
> break, and the exact sequence to take it from clone → running, including wiring up the
> user's own CRM. It's written to be executed, not just read.

---

## Your task, in one line

Get **Investor Signals + Sales Enrichment** running for the user: install everything,
collect the few things you can't invent (their Parallel API key, their fund watchlist, and
which CRM they use), launch the app, wire up their CRM, and, if they want it, create the
investor monitors and run the first sweep. Follow the steps in order; pause only for the
inputs marked **ASK THE USER**.

## What this project is

Two workflows on the Parallel **Task** and **Monitor** APIs, sharing one Python core:

1. **Investor Signals pipeline** (`monitor/`), one daily Parallel Monitor per fund on the
   user's watchlist detects new AI-native funding rounds (seed–Series B); each detection is
   verified by a chained follow-up Task (`previous_interaction_id`), scored by a priority
   policy, optionally checked against the user's CRM, and delivered to Slack (weekly digest
   or real-time webhook).
2. **Sales Enrichment app** (`project/`), a React + FastAPI app. Type a company → two
   concurrent Task runs (account + contacts) merge into one cited `ResearchBrief`. Bulk CSV
   mode and an ad-hoc "ask bar" too.

**Stack:** FastAPI (Python ≥ 3.12) backend, Vite + React + TypeScript frontend, deployable
to Vercel as one serverless function + static build. `parallel-web` SDK.

## Map of the code

| Path | What it is |
|---|---|
| `project/backend/parallel_client.py` | ★ The **only** file that reads `PARALLEL_API_KEY` and calls the Task API. |
| `project/backend/investor_core.py` | ★ Shared core: qualification schema, priority policy, Slack Block Kit formatting. One source of truth for the CLI, the app, and the webhook. |
| `project/backend/crm.py` | ★ The **CRM adapter seam**: selects a provider and normalizes its result. This is where you plug in the user's CRM. |
| `project/backend/attio_client.py` | The reference CRM adapter (Attio). Copy it to add another CRM. |
| `project/backend/main.py` | FastAPI routes, the access gate, the webhook receiver, the cron endpoint. |
| `project/backend/signals_service.py` | Signals surfaces + the weekly-digest job. |
| `project/src/` | The React app. `types.ts` mirrors the backend `ResearchBrief` exactly. |
| `monitor/config.py` | Loads the watchlist + holds the monitor queries/schemas/processors. |
| `monitor/investors.example.json` | Sample watchlist. Copy to `investors.json` (gitignored). |
| `monitor/{sweep,monitors,check,slack_notify,build_portfolio}.py` | The pipeline CLI. |
| `tests/` | pytest suite (credibility gate, priority policy, routes, Slack blocks). |

## Invariants: do not break these

1. **The API key stays server-side.** Only `parallel_client.py` (and the async webhook in
   `main.py`) touch `PARALLEL_API_KEY`. The browser talks exclusively to `/api/*`. Never
   put the key in frontend code, logs, or anything committed.
2. **Never fabricate a value.** The credibility rule is load-bearing: any field without a
   supporting citation is returned as `null`. Don't "helpfully" fill blanks.
3. **Don't touch the output JSON schemas or the `field-basis` beta header** in
   `parallel_client.py` without updating `types.ts` and `to_research_brief()` in lockstep,    the field names map one-to-one to the UI.
4. **Secrets and private data never get committed.** `.env`, `monitor/investors.json`,
   `data/`, and the generated `monitor/*.json` (`portfolio_names.json`, `monitors.json`,
   `signals.json`, `state.json`) are all gitignored. Keep them that way. Use the
   `.example` files for anything you commit.
5. **The watchlist and the CRM belong to the user.** There is no default fund list, and no
   CRM is assumed, ask.

## Setup sequence

Run these from the recipe root (`python-recipes/parallel-investor-signals`).

### Step 1: install (safe to run unattended)

```bash
make setup     # creates the venv, installs backend + dev + frontend deps, scaffolds .env
```

### Step 2: collect what you can't invent

**ASK THE USER** for:

- **Their Parallel API key** (from [platform.parallel.ai](https://platform.parallel.ai)).
- **The VC funds they want to track**, by press name (e.g. "Sequoia Capital",
  "Andreessen Horowitz"). If they don't have a list yet, use the example list and tell them
  they can edit `monitor/investors.json` later.
- **Which CRM they use** (Attio, HubSpot, Salesforce, Pipedrive, Affinity, none, …). You'll
  wire it up in Step 4.

Write the key and watchlist (do **not** echo the key back or commit `.env`):

```bash
# .env: set at least these two
#   PARALLEL_API_KEY=<their key>
#   DEMO_PASSWORD=<any passphrase; the app gate is closed until this is set>

cp monitor/investors.example.json monitor/investors.json
# then edit monitor/investors.json → the "investors" array = their funds
```

Confirm the backend can see the key without printing it:

```bash
source project/backend/.venv/bin/activate
python -c "import os,dotenv; dotenv.load_dotenv('.env'); print('key_loaded:', bool(os.environ.get('PARALLEL_API_KEY')))"
```

### Step 3: run the enrichment app

Launch both processes (background them or use two terminals):

```bash
make backend      # FastAPI on :8000
make frontend     # Vite on :5173
```

Tell the user to open **http://localhost:5173**, unlock with their `DEMO_PASSWORD`, and try
`ramp.com`. Backend health (no secret leaked): `curl -s localhost:8000/api/health`.

### Step 4: wire up their CRM

The CRM is **pluggable**. The signals pipeline asks one question about each company, *already in our CRM? active deals? who owns it?*, through the small contract in
`project/backend/crm.py`. Your job: make that contract answer against the user's CRM.

- **If they use Attio** → it's the reference adapter and already implemented. Just set
  `CRM_PROVIDER="attio"` and `ATTIO_API_KEY=...` in `.env`. Done.
- **If they use another CRM** → build an adapter:
  1. **Find the API docs.** Look up that CRM's REST API, the endpoints for *search/query a
     company by domain or name*, *list a company's deals/opportunities*, and *get the record
     owner*, plus how auth works (usually a Bearer token or OAuth). Use web search / fetch
     the official developer docs; confirm the exact request/response shapes before coding.
  2. **Implement the adapter.** Copy `project/backend/attio_client.py` to
     `project/backend/<crm>_client.py` and implement the three names the contract requires
     (read the docstring at the top of `crm.py`):
     - `NAME: str`, e.g. `"HubSpot"`
     - `def enabled() -> bool`, is its API key configured?
     - `def check_pipeline(domain, company) -> dict | None`, return
       `{in_crm, record_id, deal_count, owner, url}`, or `None` when unavailable.
  3. **Register it** in `crm.py`'s `_PROVIDERS` dict, add the key var to `.env.example`, and
     set `CRM_PROVIDER=<crm>` + the API key in `.env`.
  4. **Verify** against a company you know is in their CRM:
     ```bash
     python -c "from project.backend import crm; print(crm.check_pipeline('ramp.com','Ramp'))"
     ```
     (Run from the recipe root with the venv active; expect the normalized dict or `None`.)
- **If they use no CRM** → skip it. Signals fall back to the local known-companies label and
  everything else runs unchanged.

Keep the credibility and secrets invariants: the CRM key is server-side only, and never
invent fields the CRM API didn't return.

### Step 5: the investor-signals pipeline (only if the user wants it)

Creating monitors **spends Parallel credits and creates cloud resources**: confirm with the
user before running `monitors.py create`.

```bash
source project/backend/.venv/bin/activate
python monitor/sweep.py                 # once: 60-day backfill per fund → signals.json
python monitor/monitors.py create       # once: one daily monitor per fund (cloud resource)
python monitor/check.py                 # drain + verify new events (run on any cadence)
python monitor/slack_notify.py --preview   # dry-run the Slack format
```

To clean up the cloud monitors later: `python monitor/monitors.py cancel`.

### Step 6: verify your work

```bash
make test     # backend pytest + frontend vitest, must pass
make lint     # ruff
```

If you added a CRM adapter, add a small unit test for its `check_pipeline` result mapping
(stub the HTTP call, no live CRM in tests, mirroring `tests/conftest.py`).

## Deploying (only when asked)

Vercel: static Vite build + FastAPI as one serverless function (`project/api/index.py`,
`project/vercel.json`). From `project/`: `vercel deploy --prod --yes`, then
`vercel env add <VAR> production` for each required variable (including `CRM_PROVIDER` and
your CRM's key). See the README's [Deployment](README.md#deployment-vercel) section. For
real-time Slack push, register the webhook with
`python monitor/monitors.py set-webhook https://<app>.vercel.app`.

## When you're done

Report to the user: what's running and on which ports, which CRM you wired up (and whether
its live check succeeded), whether monitors were created (that they cost credits + how to
cancel), whether tests passed, and the one or two things still in their hands. Never claim
the pipeline is "live" if you only ran setup, say exactly what you did.
