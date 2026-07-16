# Parallel Sales Enrichment

Cited, real-time GTM account + contact enrichment, powered by the **Parallel Task API**.
Type a company; get a fully-sourced account brief (firmographics · funding · tech stack · buying signals) plus decision-maker contacts, every claim traceable to the exact web page it came from. Ask ad-hoc questions in the ask bar and pin the cited answers to the profile. Save profiles to a home dashboard. Or upload a CSV and export the whole list enriched.

It shows Parallel replacing a Crunchbase / ZoomInfo / Clay stack for outbound enrichment, live, cited web research at request time instead of a stale database snapshot.

## Run it

Prereqs: Node ≥ 20, Python ≥ 3.12, and `PARALLEL_API_KEY` in the **repo-root** `.env` (one level above this folder):

```bash
# ../.env
PARALLEL_API_KEY=your_key_here     # server-side only, never exposed to the browser
```

Two processes, from this `project/` folder:

```bash
# 1. Backend (FastAPI on :8000)
source backend/.venv/bin/activate
uvicorn backend.main:app --reload --port 8000

# 2. Frontend (Vite on :5173: proxies /api to :8000)
npm install
npm run dev
```

Open **http://localhost:5173**. Backend health check: http://127.0.0.1:8000/api/health (returns `key_loaded` as a bool, never the key).

First-time backend setup (if `.venv` doesn't exist yet): `python3 -m venv backend/.venv && source backend/.venv/bin/activate && pip install -r backend/requirements.txt`

## How it uses Parallel

One lookup = **two concurrent Task API runs** (account + contacts), merged into a single `ResearchBrief`:

- **Endpoint**: `task_run.create(...)` → `task_run.result(run_id, api_timeout=...)`, structured JSON output schema.
- **Research basis**: each field returns citations (URL + excerpts) + a confidence rating. The beta header `parallel-beta: field-basis-2025-11-25` gives *each contact its own citations*.
- **Processors**: Fast = `core-fast` (~60–80s per lookup), Deep = `pro-fast`. Switchable in the UI.
- **Credibility rule** (enforced server-side): a value with no supporting citation is returned as `null`, the UI shows a dash, never an unsourced claim. Contact methods (`contact_methods`) are either citation-backed emails/phones, preferring ZoomInfo, RocketReach, or another verified contact-data database, up to 3 per contact ordered by confidence, or a clearly labeled **inferred** email pattern guess, never "verified."

**Custom research** is a third kind of run, using ONE fixed generic schema (an `answers` array, see `_CUSTOM_SCHEMA` in `parallel_client.py`). The questions live in the natural-language input, never in the schema, so the schema never changes as questions do; per-answer citations come from the same per-array-element basis as contacts. Two paths use it:

- **Ask bar** (single mode, `POST /api/enrich/custom`): one question → one cited answer, researched alone, no account/contacts re-run. Answers are ephemeral until pinned to the profile with "+ Add to profile."
- **Bulk custom columns** (`POST /api/enrich/bulk` with `custom_fields`): each question becomes an extra researched column per company, included in the CSV export.

## Project structure

```
parallel-investor-signals/
├── .env                      # PARALLEL_API_KEY (recipe root, gitignored, server-side only)
└── project/
    ├── backend/
    │   ├── parallel_client.py   # ★ THE Parallel API call file, the only place that
    │   │                        #   reads the key & talks to the Task API. Header comment
    │   │                        #   says exactly what's safe to tweak live on a call.
    │   ├── main.py              # FastAPI routes: /api/enrich, /api/enrich/custom (ask bar),
    │   │                        #   /api/enrich/bulk (+poll, +export.csv), /api/health.
    │   │                        #   CSV flattening lives here.
    │   ├── models.py            # Pydantic request models (EnrichRequest, BulkRequest,
    │   │                        #   CustomFieldDef, slug keys derived server-side)
    │   └── requirements.txt     # pinned backend deps (incl. parallel-web SDK)
    ├── src/
    │   ├── App.tsx              # app shell: modes, profiles, cache, keyboard, state machine
    │   ├── types.ts             # the ResearchBrief contract (mirrors backend exactly)
    │   ├── lib/
    │   │   ├── api.ts           # thin client for our /api routes (never calls Parallel)
    │   │   ├── profiles.ts      # saved company profiles (localStorage), the Home data
    │   │   ├── cache.ts         # localStorage session cache + recent-lookup chips
    │   │   ├── customFields.ts  # custom-question helpers (session-only, no persistence)
    │   │   ├── format.ts        # hostname/latency/label helpers
    │   │   └── useTheme.ts      # light/dark toggle (persisted, honors OS pref)
    │   ├── components/
    │   │   ├── HomePage.tsx           # dashboard: saved-profile previews, open/delete/new
    │   │   ├── EnrichSearchBar.tsx    # query input + Fast/Deep depth toggle
    │   │   ├── AskBar.tsx             # ask anything about the loaded account → cited
    │   │   │                          #   answer inline; "+ Add to profile" pins it
    │   │   ├── LiveResearchState.tsx  # the ~75s wait, made honest: elapsed timer,
    │   │   │                          #   two run streams, staged narrative
    │   │   ├── BriefHeader.tsx        # company header, coverage meter, cached badge,
    │   │   │                          #   Save profile / Saved ✓
    │   │   ├── AccountCard.tsx        # the cited field groups (+ 05 Custom Research)
    │   │   ├── FieldRow.tsx           # one claim: value · confidence · source marker
    │   │   ├── SourceDrawer.tsx       # ★ the wow: excerpt-level proof per claim
    │   │   ├── ContactsTable.tsx      # decision-makers; inferred emails labeled
    │   │   ├── BulkPanel.tsx          # CSV/paste → progress → enriched CSV export
    │   │   ├── CustomFieldsEditor.tsx # bulk-mode custom questions (→ extra columns)
    │   │   ├── ConfidencePill.tsx     # high/medium/low/inferred pill
    │   │   ├── Header.tsx             # wordmark, Home/Enrich/Bulk switch, theme toggle
    │   │   └── States.tsx             # empty + error states
    │   └── brand/parallel-theme.css   # official Parallel design tokens + fonts
    └── vite.config.ts           # dev proxy /api → :8000 (key never in the browser)
```

## 60-second walkthrough

A narration you can follow to see everything the app does, end to end:

1. *"Teams stitch together Crunchbase, ZoomInfo and Clay to build an account view. Watch what the Parallel API does instead."*
2. Type `ramp.com`, depth **Fast**, hit **Enrich**. While it runs: *"This is live web research happening right now, two Parallel Task runs, account and contacts, in parallel. Not a stale database."*
3. Brief lands: firmographics, funding (current round + valuation), tech stack, fresh buying signals. *"Everything you see was researched seconds ago."*
4. **Click a source marker** on the valuation → the drawer shows the exact excerpt + URL. *"Every field is grounded, this is the actual sentence on the actual page. Nothing is hallucinated."*
5. In the **ask bar**: type *"Are they SOC 2 compliant?"* → cited answer in seconds. Hit **+ Add to profile**. *"Any question, answered live with sources, and Clay can't show you the sentence behind the cell."*
6. Scroll to decision-makers: *"Names, titles, LinkedIn, with per-contact sources. Emails are either publicly cited or clearly labeled as inferred patterns. We don't fake verified emails."*
7. Hit **Save profile +**, then **Home**: *"Saved briefs live on the rep's dashboard, one click back into any account, refreshable any time."*
8. Switch to **Bulk**, paste 3 domains, **Enrich** → progress bar → **Export enriched CSV**. *"And that's the Monday-morning workflow: list in, enriched list out."*

Pro tip: pre-warm the accounts you plan to show (run them once beforehand), save them as profiles and open them from **Home** instantly, with an honest "cached" badge and a one-click live refresh.

## What's safe to change

In `backend/parallel_client.py` (see its header comment): the processor tiers in `_DEPTH_CONFIG`, the natural-language framing in `_account_input` / `_contacts_input` / `_custom_input`, and timeouts. **Don't** touch the output JSON schemas or the beta header without updating the frontend contract in lockstep.

## Notes & limits

- Bulk job state is in-memory, restarting the backend clears running jobs.
- Saved profiles + session cache are per-browser localStorage, personal to each rep's browser, not shared across machines. A saved profile auto-updates when you refresh its data or pin an ask-bar answer.
- Ask-bar / bulk custom questions are session-only by design, a page refresh starts clean.
- A single Fast lookup is ~60–80s (two concurrent live research runs); an ask-bar question is a single run and returns faster. The loading state narrates the work; it's a feature of the story, not dead air.
- Obscure companies can come back sparse, the credibility rule nulls anything uncited, and the UI shows a "low signal" banner rather than making things up. Ask-bar answers follow the same rule: no cited source → "No cited answer found."
