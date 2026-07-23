# Datacenter Monitor

A live map of U.S. datacenter infrastructure, built end-to-end on [Parallel](https://parallel.ai)'s **Task API** and **Monitor API**. Every facility on the map was *discovered*, *enriched*, and *classified* by Parallel — and 31 monitors watch the web for new developments, with each claim traceable to its sources.

**Live demo:** https://datacenter-demo.app

Everything here — the facility list, the 25 fields per facility, the AI-impact classifications, the weekly brief — is generated data. Nothing is hand-curated. This README documents exactly how it was produced so you can reproduce or extend it.

> **Note on data:** this repo ships a **51-facility sample** (one per state) in `public/data/` so the app runs immediately after cloning. The [live demo](https://datacenter-demo.app) shows the full ~2,700-facility dataset. Run the pipeline below to regenerate the full set into `public/data/`. Monitor IDs in `src/data/` ship blank on purpose — run `setup-monitors.ts` and `create-snapshots.ts` to create your own against your account.

---

## How the data was built

The whole dataset is a pipeline of Parallel Task API runs. Each stage is a script in [`scripts/`](./scripts).

### 1. Discover the facilities — `build_datacenters_iterative.py`

There is no clean public registry of U.S. datacenters, so we enumerate them with the Task API. A single "find all US datacenters" query plateaus around ~50 results — the model returns the hyperscaler campuses it has the most signal about and can't reach the long tail of ~1,800 colocation, enterprise, telecom, and edge operators. Two techniques fix that:

1. **Shard by geography.** Scope every query to *one state*. Enumerating a single state (reading facility directories) is the natural move, instead of dumping a global top-of-mind list. Ashburn alone goes 13 → ~90 this way.
2. **Paginate via interactions (loop-until-dry).** After the first pass for a state, keep asking for *net-new* facilities while passing `previous_interaction_id`. The model carries its own memory of what it already returned in that thread, so we never paste a list of known facilities into the prompt. Loop until a page stops adding results.

Everything is resumable: results checkpoint after each shard, and every `run_id` / `interaction_id` is logged so work that completed server-side is always recoverable.

```bash
export PARALLEL_API_KEY=...
python scripts/build_datacenters_iterative.py                 # all 50 states + DC, until dry
python scripts/build_datacenters_iterative.py --states "Texas,Ohio" --workers 8
```

This produced **2,811 unique facilities** (deduped to 2,694 shown on the map) across all 50 states + DC — each with a name, operator, owner, coordinates, and a source URL.

### 2. Enrich each facility — `run-enrichment*.ts`

Every facility is then deep-researched with the `ultra2x` processor against a **25-field JSON schema** (verified name/operator/owner, power capacity, sqft, cooling type, tier, fiber, utility provider, tax incentives, hazard zone, construction updates, recent news, tenants, and more). Runs are submitted in parallel via **Task Groups**, and Parallel's `output.basis` gives per-field **reasoning + citations** for every value — that's what powers the basis panel behind each cell.

```bash
npx tsx scripts/run-enrichment-v2.ts        # submit enrichment task group
npx tsx scripts/collect-enrichments-v2.ts   # collect results
npx tsx scripts/upload-per-facility.ts      # store per-facility basis in Vercel Blob
```

### 3. Classify AI impact — `classify-ai.ts`

A second Task API pass classifies each facility's AI profile and community/resource impact against a structured schema: `ai_class` (ai-training / ai-inference / ai-mixed / cloud-hyperscale / not-ai), plus water impact, grid impact, and community-pushback levels — each with its own evidence and citations. ~710 facilities classified; ~520 flagged as AI/cloud infrastructure.

### 4. Monitor the web — `setup-monitors.ts` + `create-snapshots.ts`

- **31 event-stream monitors** watch for datacenter developments — power-grid changes, zoning decisions, ownership transfers, community opposition, new-site discovery — returning classified, cited events.
- **200 daily snapshot monitors** re-verify facility fields once a day and surface field-level changes as diffs (with the re-verification's own reasoning + sources).

---

## What the app does

- **Interactive map** of every facility, colored by lifecycle (operational / under construction / planned / decommissioned), with scope toggles (all vs. AI datacenters) and monitor-driven highlighting.
- **Popups** with the enriched profile, AI-impact classification, and clickable primary sources loaded on demand.
- **Dataset table** with all 25 fields per facility. Click any cell to open its **basis panel** — the reasoning and citations Parallel used to produce that value.
- **Live monitor feed** with a chart-as-filter (break down by time / category / severity) and cited events.
- **Weekly brief** — a newsletter deep-researched and written by the Task API across all monitors, every claim linked to a source.

## Parallel APIs used

**Task API**
- Iterative facility discovery via interaction chaining (`previous_interaction_id`)
- 25-field facility enrichment (`ultra2x`, Task Groups, structured output)
- AI-impact classification (structured output)
- Weekly brief research + writing
- `output.basis` → per-field reasoning + citations everywhere

**Monitor API**
- 31 event-stream monitors (classified events with severity + citations)
- 200 daily snapshot monitors (field-level change detection with diffs)
- Webhooks + SSE for real-time updates

## Tech stack

- **Next.js 16** (App Router, TypeScript)
- **react-leaflet** + Leaflet (map)
- **Tailwind CSS** (Parallel design system)
- **Vercel** (hosting, Blob storage, serverless, cron)

---

## Setup

**Prerequisites:** Node.js 18+, Python 3.9+, a [Parallel API key](https://platform.parallel.ai), and a Vercel account (Blob storage + deploy).

```bash
git clone https://github.com/parallel-web/parallel-cookbook.git
cd parallel-cookbook/typescript-recipes/parallel-datacenter-map
npm install
cp .env.local.example .env.local   # add your keys
```

Then run the pipeline to regenerate the full dataset (the repo ships only a 51-facility sample in `public/data/`; each stage is optional):

```bash
# 1. discover facilities
pip install parallel-web
python scripts/build_datacenters_iterative.py

# 2. enrich + classify
npx tsx scripts/run-enrichment-v2.ts
npx tsx scripts/collect-enrichments-v2.ts
npx tsx scripts/upload-per-facility.ts
npx tsx scripts/classify-ai.ts

# 3. set up monitors
npx tsx scripts/setup-monitors.ts
WEBHOOK_URL=https://your-app.vercel.app/api/webhook npx tsx scripts/create-snapshots.ts

# 4. run
npm run dev       # local
vercel --prod     # deploy
```

## Architecture

```
Map view                         Monitor panel (right rail)
- Leaflet map, 2,694 facilities  - Chart-as-filter (time / category / severity)
- lifecycle + AI scope toggles   - Cited event feed
- popups: profile, AI impact,    - Weekly brief reader
  on-demand sources

Dataset view
- 25 enriched fields per facility
- per-cell basis panel (reasoning + citations, from Vercel Blob)
- monitor signals + snapshot diffs

API routes
  /api/monitors            live events from the 31 event-stream monitors
  /api/snapshots           daily snapshot change detection (with basis)
  /api/basis               per-facility reasoning + citations (Vercel Blob)
  /api/webhook             receives monitor events (SSE to the client)
  /api/newsletter/*        weekly brief generate / preview / issue list
  /api/cron/newsletter     weekly brief cron
```

## Scripts

| Stage | Script | Purpose |
|-------|--------|---------|
| Discover | `build_datacenters_iterative.py` | Enumerate U.S. facilities (shard-by-state + interaction pagination) |
| Enrich | `run-enrichment.ts` / `run-enrichment-v2.ts` | Submit facility enrichment task groups (`ultra2x`) |
| Enrich | `collect-enrichments*.ts` | Collect enrichment results |
| Enrich | `upload-per-facility.ts` / `upload-enrichments.ts` | Store per-facility basis in Vercel Blob |
| Enrich | `backfill-basis.ts` | Re-fetch a run's basis from its `run_id` onto a stored facility |
| Classify | `classify-ai.ts` | AI-impact classification pass |
| Monitor | `setup-monitors.ts` / `monitor-configs.ts` | Create the 31 event-stream monitors |
| Monitor | `create-snapshots.ts` / `snapshots-to-daily.ts` | Create/tune daily snapshot monitors |
| Monitor | `set-webhooks.ts` / `check-events.ts` | Register webhooks / inspect events |
| Brief | `generate-issue.ts` / `seed-issue.ts` / `regenerate-brief.ts` | Generate the weekly brief |

## License

MIT — see [LICENSE](./LICENSE).
