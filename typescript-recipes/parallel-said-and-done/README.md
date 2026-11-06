# Said & Done

What 100 public companies promised on their earnings calls, and what happened.
Live demo: [earnings-calls.paralleldemos.com](https://earnings-calls.paralleldemos.com)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fparallel-web%2Fparallel-cookbook%2Ftree%2Fmain%2Ftypescript-recipes%2Fparallel-said-and-done&project-name=parallel-said-and-done&repository-name=parallel-said-and-done)

Each company gets a one-page tear sheet: five promises still in play, every
dated statement about them, how each one turned out, and a word-for-word quote
from the source behind every line.

## What it shows

Everything on screen comes from [Parallel](https://parallel.ai) APIs:

- **Task API** researches each company and each promise, then fact-checks every outcome with independent runs.
- **Extract API** reads full pages to back statements with exact quotes.
- **Search API** finds a page when none was cited.
- **Image Search API** supplies logos and photos.
- **Monitor API** watches every company for new calls and announcements.

Matching quotes, marking figures and gating what gets published are plain
string and count rules. No other model is called.

## Architecture

```text
config/companies.json   the only hand-entered data: which companies, names, websites
data/                   what the pages read: published sheets and company profiles
output/                 raw responses, the pipeline's full sheets, runs in flight, call-day records, monitor records (gitignored)
src/parallel/           the parallel-web SDK client, Task runs, Image Search
src/sheet/              making a sheet: stages 1 to 3 and the gate
src/updates/            keeping it current: monitors, call day, update runs
src/pipeline/           what happens when a run finishes: the next step, the hourly reconcile, local runs
src/app/api/            the webhook route and the hourly cron route
src/app, components/    the pages: a company directory and one page per company
scripts/                CLI entry points
```

```text
Monitor (every 6 h) ──monitor.event.detected──▶ /api/webhooks/parallel ──▶ Search + Extract the call ──▶ update Task run
Task run ──────────────task_run.status─────────▶ /api/webhooks/parallel ──▶ store result ──▶ next step ──▶ more Task runs, or publish
Vercel Cron (hourly) ──────────────────────────▶ /api/cron/reconcile ─────▶ anything a webhook missed, new companies
```

State lives in [`src/storage.ts`](src/storage.ts): the app folder locally, a
private Vercel Blob store on the deployment. The pages read published sheets
from the same place.

## Quick Start

From this folder:

```bash
pnpm install
pnpm dev            # http://localhost:3240, using the recorded data in data/; no API key needed
```

To make or update sheets, add a key from [platform.parallel.ai](https://platform.parallel.ai)
to `.env.local`:

```bash
PARALLEL_API_KEY=...
pnpm sheet MSFT     # stage 1 for one company
pnpm deepen MSFT    # stages 2 and 3
```

Locally there is no public URL for webhooks, so each script waits on the runs
it starts and handles their results the way the webhook route would.

`pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` run offline.

### Deploy

The Deploy button gives a read-only copy: it serves the recorded `data/`,
needs no key, and its webhook and cron routes do nothing. To keep a deployment
current:

1. Add `PARALLEL_API_KEY`, and connect a private Blob store to the project
   (Storage → Blob), which sets `BLOB_READ_WRITE_TOKEN`.
2. Set `WEBHOOK_URL` to `https://<your-domain>/api/webhooks/parallel`.
3. Seed the store from this folder, with the store's token from `vercel env pull`:

   ```bash
   pnpm state push          # data/ and output/ → Blob
   ```

[`vercel.json`](vercel.json) runs the reconcile every hour. Its first run
points every monitor at `WEBHOOK_URL`; from then on, Task runs and monitors
report to the webhook.

## How it works

### Making a sheet

[`src/sheet/make-sheet.ts`](src/sheet/make-sheet.ts) and
[`src/sheet/deepen.ts`](src/sheet/deepen.ts) are the recipe. Each step is its own module.

| Stage | API | Module | What it does |
| --- | --- | --- | --- |
| 1. Sheet | Task (`ultra2x`) | [`sheet/spec.ts`](src/sheet/spec.ts) | One run per company picks five promises still in play and drafts their history. Its output schema is the sheet template. |
| | Extract, Search | [`sheet/evidence.ts`](src/sheet/evidence.ts), [`sheet/fill.ts`](src/sheet/fill.ts) | A statement is shown in quotation marks only when its quote appears word for word in one of its own citations. Otherwise Extract reads the cited page in full, or Search finds one first. |
| | Image Search | [`sheet/images.ts`](src/sheet/images.ts) | A logo and a header photo per company. |
| | Task (`base`) | [`sheet/profile.ts`](src/sheet/profile.ts) | The GICS sector and industry, for the directory filters. |
| 2. History | Task (`ultra4x`) | [`sheet/trail.ts`](src/sheet/trail.ts) | One run per promise rebuilds its history: every call since it was first made, each stance judged against the previous statement, the document type (call, earnings release, filing…), and outcome figures only as a source states them. |
| 3. Fact-check | Task (`ultra`) | [`sheet/check.ts`](src/sheet/check.ts) | One independent run per promise, not chained to the others, checks the outcome and each statement's date and stance. If one check disputes an outcome, two more run. If most agree, a deeper run ([`sheet/resolve.ts`](src/sheet/resolve.ts)) settles it with sources, and a fresh check confirms the result. |
| Gate | (none) | [`sheet/build.ts`](src/sheet/build.ts), [`sheet/gate.ts`](src/sheet/gate.ts) | Holds back any quote whose source names a different call than the statement, and publishes to `data/` only if no check fails. |

Every raw response is saved to `output/raw/` before anything is derived from
it, so `pnpm rebuild` re-derives every sheet after a rule change with no API calls.

**Why three stages.** We fact-checked 26 promises made by stage 1 alone. Every
quote was real, but 4 of 137 statements were dated to the wrong call and 11
earnings-release passages were labelled as calls. The fact-check also disagreed
with 9% of the stances and found 2 errors in outcome summaries. With stages 2
and 3, the same 26 promises had no misdated statements, no mislabels, 2.8% stance
disagreements and no summary errors, with a third more statements, all quoted
verbatim.

Across all 100 companies, every published outcome is confirmed by an independent
fact-check. Six were changed by the resolution step. 2,965 of 2,970 statements
are backed by an exact quote.

### Keeping it current

One `event_stream` monitor per company (`lite`, every 6 hours) reports
structured events to the webhook. Routing in [`updates/monitor-events.ts`](src/updates/monitor-events.ts)
is deterministic:

| Event | Acted on when | What runs |
| --- | --- | --- |
| `earnings_call_held` | the call is newer than the sheet's latest call | Search finds the transcript and Extract reads it. An update Task run (`ultra`, chained with `previous_interaction_id`) adds the call's statements and any new promises, then the gate. |
| `earnings_call_scheduled` | the date is after the latest call | Sets the next-call date. If that date passes with no "held" event, the call is processed anyway. |
| `promise_update` | about a tracked promise, from the company's own site, SEC or a newswire, and newer than what the sheet has read | Extract reads the announcement, then the same update run and gate. |

Every Task run carries the webhook. When one finishes,
[`pipeline/advance.ts`](src/pipeline/advance.ts) stores the result, then works
out the next step for that company from its stored state alone: a history for
each new promise, Extract fills, a check for each outcome without a current one,
a vote or a resolution for a dispute, and finally a new version if anything
changed. A duplicate webhook, a retry, or a missed one picked up later by the
hourly reconcile all land in the same place.

**Webhook security.** The route never trusts the body. It takes only the run or
monitor ID, fetches the run or the monitor's events with the app's own key, and
acts only on runs it started and monitors it owns. A forged request can at most
make it re-read its own state. Webhooks for one company are handled one at a
time behind a lock.

```bash
pnpm monitors create      # one monitor per company
pnpm monitors poll        # locally: the reconcile, then wait on any runs it starts
pnpm monitors list
pnpm monitors cancel --yes   # stays cancelled; the reconcile does not recreate it
```

**Adding a company** is one line in [`config/companies.json`](config/companies.json)
(ticker, name, website). After the next deploy, the hourly reconcile makes its
sheet, runs stages 2 and 3, looks up its sector and gives it a monitor.

### Cost

| Item | Processor | About |
| --- | --- | --- |
| Sheet run, per company | `ultra2x` | $0.60 |
| History runs, per company | 5 × `ultra4x` | $6.00 |
| Fact-checks, per company | 5 × `ultra` | $1.50 |
| Update run, per earnings call | `ultra` | $0.30 |
| Monitor, per company per month | `lite`, every 6 h | $0.36 |

Extract, Search and Image Search add a few cents per sheet.

## Data and design rules

- **Data.** Text in quotation marks is verbatim from a source, which is named
  underneath, and at most 60 words: a longer sentence is cut at a clause break,
  never reworded. Where no verbatim text was found, the Task's summary shows in
  grey italics. No figure is typed by hand.
- **Published copy.** The pipeline keeps each sheet in `output/sheets/` with the
  request IDs it needs to chain update runs. `data/` gets the same sheet without
  them ([`sheet/public.ts`](src/sheet/public.ts)). A fresh clone has no
  `output/`, so the recorded sheets are read-only there; `pnpm sheet` makes a
  new one that can then be deepened and kept current.
- **Design.** Signal orange marks one thing only: a statement that changed the
  target. Outcomes are written as words, and figures are bold.
- **Authored by hand.** Besides `config/companies.json`, these are written by hand:
  - the specs and request builders (`sheet/*.ts`, `updates/spec.ts`);
  - the source host lists (`sheet/evidence.ts`);
  - the transcript pick rule (`updates/callday.ts`);
  - the image pick rules (`sheet/images.ts`);
  - the gate thresholds (`sheet/gate.ts`).
- **Fonts.** Parallel's brand fonts are licensed and are not in this repository.
  Set `BRAND_FONTS_DIR` to use them; otherwise the pages use Geist.
- **Source link.** The header links to this source. Set `NEXT_PUBLIC_SOURCE_URL`
  if it moves.

## Limits

- Stances and outcomes are judgments made by the Task and confirmed by an
  independent Task. The verbatim quote beside each statement is what lets a
  reader check them.
- Logos and photos are linked from their source pages, not copied. A broken link
  falls back to the ticker chip.
- Not investment advice.

## License

MIT. See [LICENSE](LICENSE).
