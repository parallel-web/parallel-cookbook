# Said & Done

What 100 public companies promised investors, on earnings calls and in company
releases, and what happened. Live demo: [earnings-calls.paralleldemos.com](https://earnings-calls.paralleldemos.com)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fparallel-web%2Fparallel-cookbook%2Ftree%2Fmain%2Ftypescript-recipes%2Fparallel-said-and-done&project-name=parallel-said-and-done&repository-name=parallel-said-and-done)

Each company gets a one-page tear sheet with its tracked promises, their dated
statements and outcomes, and the source evidence the research found.

## What it shows

Everything on screen comes from [Parallel](https://parallel.ai) APIs:

- **Task API** researches each company and each promise, then fact-checks every outcome with separate runs. The fact-check is AI research, not a person.
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
Optional hourly Vercel Cron ───────────────────▶ /api/cron/reconcile ─────▶ recover missed work for live companies
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

To research a company, set `PARALLEL_API_KEY` in `.env.local`. [Get an API key](https://platform.parallel.ai)

The initial research costs about $8.10 per company before extra searches and checks.
Publishing the baseline starts a recurring monitor (about $0.36 per month) that keeps running after the CLI exits.

```bash
pnpm sheet MSFT
```

The CLI waits for the runs locally and reports how many histories and fact-checks reached the published sheet.
If a stage stops after publication, fix the reported problem and run `pnpm deepen MSFT` to resume pending work.
If the connection dropped while creating a Task, check the Parallel dashboard before retrying. The run may have started.
To stop recurring charges for this company, run `pnpm monitors cancel MSFT --yes`.

`pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` run offline.

### Deploy

The Deploy button serves the recorded sheets on Vercel Hobby with no API key, Blob store or scheduled jobs.

To keep one company live:

1. Connect a private Blob store to the Vercel project. Set `PARALLEL_API_KEY`,
   `WEBHOOK_URL=https://<your-domain>/api/webhooks/parallel` and `PARALLEL_WEBHOOK_SECRET`
   in the deployment environment, then redeploy. Get the signing secret from
   **Settings → Webhooks** in the same Parallel account as the API key.
2. From this folder, set the same API key, webhook URL and store's `BLOB_READ_WRITE_TOKEN`
   in `.env.local`. Run `pnpm sheet MSFT` for each ticker you choose. This starts paid
   research (about $8.10 per company before extras) and a recurring Monitor after
   the sheet passes its gate. The command prints the published version and monitor ID.
   Run `pnpm monitors list` to verify the active monitor points to the deployment.
   The other companies continue to show their recorded sheets.
3. For hourly recovery on Vercel Pro or Enterprise, set `CRON_SECRET` on the project,
   copy [`vercel.live.json`](vercel.live.json) to `vercel.json` in the recipe root, and redeploy
   with that file. You can also run `pnpm monitors poll MSFT` manually with the same store.

## How it works

### Making a sheet

[`src/sheet/make-sheet.ts`](src/sheet/make-sheet.ts) and
[`src/pipeline/advance.ts`](src/pipeline/advance.ts) are the recipe. Each step is its own module.

| Stage | API | Module | What it does |
| --- | --- | --- | --- |
| 1. Sheet | Task (`ultra2x`) | [`sheet/spec.ts`](src/sheet/spec.ts) | One run per company picks five promises still in play and drafts their history. Its output schema is the sheet template. |
| | Extract, Search | [`sheet/evidence.ts`](src/sheet/evidence.ts), [`sheet/fill.ts`](src/sheet/fill.ts) | The app distinguishes exact quote matches from related source excerpts. Otherwise Extract reads the cited page in full, or Search finds one first. |
| | Image Search | [`sheet/images.ts`](src/sheet/images.ts) | A logo and a header photo per company. |
| | Task (`base`) | [`sheet/profile.ts`](src/sheet/profile.ts) | The GICS sector and industry, for the directory filters. |
| 2. History | Task (`ultra4x`) | [`sheet/trail.ts`](src/sheet/trail.ts) | One run per promise rebuilds its history: every call since it was first made, each stance judged against the previous statement, the document type (call, earnings release, filing…), and outcome figures only as a source states them. |
| 3. Fact-check | Task (`ultra`) | [`sheet/check.ts`](src/sheet/check.ts) | One separate AI research run per promise, not chained to the runs that made the sheet, checks the outcome and each statement's date and stance. If one check disputes an outcome, two more run. If most agree, a deeper run ([`sheet/resolve.ts`](src/sheet/resolve.ts)) settles it with sources, and a fresh check confirms the result. |
| Gate | (none) | [`sheet/build.ts`](src/sheet/build.ts), [`sheet/gate.ts`](src/sheet/gate.ts) | Holds back any quote whose source names a different call than the statement, and publishes to `data/` only if no check fails. |

Every raw response is saved to `output/raw/` before anything is derived from
it, so `pnpm rebuild` re-derives every sheet after a rule change with no API calls.

**Why three stages.** We ran the fact-check on 26 promises made by stage 1 alone. Every
quote was real, but 4 of 137 statements were dated to the wrong call and 11
earnings-release passages were labelled as calls. The fact-check also disagreed
with 9% of the stances and found 2 errors in outcome summaries. With stages 2
and 3, the same 26 promises had no misdated statements, no mislabels, 2.8% stance
disagreements and no summary errors, with a third more statements, all quoted
verbatim.

In the recorded snapshot, independent checks agreed with all 504 outcome statuses.
Five checks flagged facts or figures in the summary. Those summaries are withheld in the reader.
Of the 2,980 entries that report a statement, 2,858 have an exact quote match,
117 have a related source excerpt, and five show a Task summary.

### Keeping it current

One `event_stream` monitor per company (`lite`, every 6 hours) reports
structured events to the webhook. Routing in [`updates/monitor-events.ts`](src/updates/monitor-events.ts)
is deterministic:

| Event | Acted on when | What runs |
| --- | --- | --- |
| `earnings_call_held` | the call is newer than the sheet's latest call | Search finds the transcript and Extract reads it. An update Task run (`ultra`, chained with `previous_interaction_id`) adds the call's statements and any new promises, then the gate. |
| `earnings_call_scheduled` | the date is after the latest call | Sets the next-call date. If that date passes with no "held" event, the call is processed anyway. |
| `promise_update` | about a tracked promise, from the company's own site, SEC or a newswire, and newer than what the sheet has read | Extract reads the announcement, then the same update run and gate. |

A call waits for a matching transcript with at least 15,000 characters of full text. A shorter transcript may need manual review.

Every Task run carries the configured webhook. When one finishes,
[`pipeline/advance.ts`](src/pipeline/advance.ts) stores the result, then works
out the next step for that company from its stored state alone: a history for
each new promise, Extract fills, a check for each outcome without a current one,
a vote or a resolution for a dispute, and finally a new version if anything
changed. A duplicate webhook, a retry, or a missed one picked up later by the
hourly reconcile all land in the same place.

**Webhook security.** The route verifies the signature and timestamp on the raw
body before making any API or storage requests. It then fetches the run or
monitor events with the app's own key and handles them under the company's lock.
See [Parallel's webhook setup guide](https://docs.parallel.ai/resources/webhook-setup).

```bash
pnpm monitors create MSFT # for a locally generated sheet
pnpm monitors poll MSFT   # reconcile this company and wait for its runs
pnpm monitors list
pnpm monitors cancel --yes   # stays cancelled; the reconcile does not recreate it
```

**Adding a company.** Add its ticker, name and website to [`config/companies.json`](config/companies.json)
and deploy that change. Run `pnpm sheet TICKER` with the deployment's store to start tracking it.

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
  never reworded. Related passages are labeled as source excerpts with no speaker attribution. Where no passage was found, the Task's summary shows in
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

- Each promise has one timeline entry per date. Once the sheet covers a date, a second announcement about the same promise that day can be missed.
- Stances and outcomes are Task judgments. Separate AI research runs assess the outcome status and flag unsupported details in its summary. Each statement links to its evidence when available.
- About half the statements come from earnings calls; the rest come from
  company releases, prepared remarks, investor days, filings and shareholder
  letters. Each statement names its document.
- Logos and photos are linked from their source pages, not copied. A broken link
  falls back to the ticker chip.
- Not investment advice.

## License

MIT. See [LICENSE](LICENSE).
