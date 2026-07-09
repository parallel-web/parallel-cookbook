# Vendor intelligence with Parallel

Build a cited vendor-risk baseline, keep it current with a snapshot Monitor, and run focused research only when deterministic policy marks a change as material.

![Vendor intelligence flow](docs/vendor-intelligence-flow.svg)

This local reference implementation has one local workflow, one state file, and three commands:

- `bootstrap` researches each vendor, scores the structured result, and creates one snapshot Monitor.
- `check-updates` processes unseen Monitor events once and launches focused follow-up research when policy requires it.
- `cleanup` cancels all—or selected—Monitor IDs owned by this recipe.

Each successful underlying script writes one JSON document to stdout; validation and startup failures leave stdout empty and report to stderr. Progress and recovery details also go to stderr. Ask npm to suppress its own banner when piping the result:

```bash
npm run --silent check-updates | jq
```

## Cost-aware flow

| Stage | Processor | When it runs |
| --- | --- | --- |
| Structured baseline | `core` | Once for each new vendor or explicit retry |
| Snapshot monitoring | `lite` | At the configured Monitor frequency |
| Focused investigation | `pro` | When a changed risk field is at or above the deterministic threshold before or after the change |

A vendor `riskFloor` at or above `FOLLOW_UP_RISK_THRESHOLD` also opens the investigation path for any changed risk field. Task Runs and active Monitors consume Parallel credits. Run `cleanup` when you finish evaluating the recipe. Task Runs are historical API resources and cannot be cancelled through the current public SDK.

## Quick start

Requirements: Node.js 20 or newer and a Parallel API key.

```bash
git clone https://github.com/parallel-web/parallel-cookbook.git
cd parallel-cookbook/typescript-recipes/parallel-vendor-intelligence
npm ci
cp .env.example .env
```

Set `PARALLEL_API_KEY` in `.env`, then run:

```bash
npm run bootstrap
npm run check-updates
npm run cleanup
```

`bootstrap` reads `examples/vendors.json` by default. Supply another file with:

```bash
npm run bootstrap -- --vendors /absolute/path/to/vendors.json
```

Each vendor has a name, domain, and optional deterministic risk floor:

```json
[
  {
    "name": "Cloudflare",
    "domain": "cloudflare.com",
    "riskFloor": "MEDIUM"
  }
]
```

Domains are normalized before any API call. The complete input must contain at least one vendor and no duplicate normalized domains.

Bootstrap is additive. Removing a vendor from the input file does not cancel its Monitor. The command returns an `omittedActiveVendors` warning for every saved active vendor absent from the current input. Cancel one explicitly with:

```bash
npm run cleanup -- --vendor example.com
```

Repeat `--vendor` to select several vendors. Run cleanup without flags to cancel every active Monitor recorded in this recipe's state.

## Output

Bootstrap returns resource counts plus one `results` entry per vendor. Each result includes:

- the baseline Task and Monitor IDs, along with whether they were created, resumed, adopted, or reused;
- the complete validated report and Task basis;
- deterministic risk, guidance, reasons, and citations;
- Task warnings returned by the API.

Running `bootstrap` again reuses the completed Task and matching active Monitor.

`check-updates` returns one `changes` entry for each successfully assessed event processed or resumed during that invocation. It includes the changed fields, current assessment, historical policy decision, and one unambiguous follow-up status:

- `not_required`
- `pending`
- `completed`, including confirmed facts, business impact, open questions, citations, and warnings
- `failed`, including the terminal Task ID and failure

An empty Monitor event page is a successful check.

## State, concurrency, and recovery

The recipe writes `.vendor-intelligence/state.json`. The file contains Task and Monitor ownership, researched evidence, policy-versioned decisions, event history, and the IDs needed to resume interrupted work. Writes are runtime-validated and atomically replace the prior file.

Only one lifecycle command can use a state directory at a time. A command lease prevents overlapping processes from creating duplicate paid Tasks or overwriting each other's state. A crashed local process leaves a lock that the next command can reclaim after confirming its PID is no longer active.

Stale-lock recovery itself uses the short-lived `.vendor-intelligence/command.lock.reclaim` directory. If the process is killed during that narrow recovery step, confirm that no lifecycle command is running, then remove that directory before retrying.

Normal commands are safe to repeat:

- A running baseline or follow-up Task is awaited instead of recreated.
- A matching active snapshot Monitor is reused or adopted.
- Monitor events are deduplicated by stable event ID across process runs.
- Invalid snapshot events are retained for inspection without blocking newer events.
- Cleanup never lists the account or cancels a Monitor absent from local state.

Paid Task and Monitor create requests disable the SDK's automatic HTTP retries because these endpoints do not expose a documented idempotency key. If a Monitor create response is ambiguous, bootstrap immediately scans for an exact metadata-and-baseline match; a later retry performs the same adoption scan before creating anything.

Remote `failed`, `cancelled`, and `action_required` Task states are terminal for this non-interactive recipe. Invalid completed Task output is terminal as well. These failures are preserved and never spend credits again automatically. Retry intentionally with:

```bash
npm run bootstrap -- --retry-failed
npm run check-updates -- --retry-failed
```

Temporary transport failures and timeouts remain resumable and do not require this flag.

If `state.json` is malformed, the recipe stops instead of resetting it. Back up and repair the file, or recover and cancel the recorded Monitor IDs before removing the state directory. A v1 state file is validated and migrated to v2 on the next write; the original is retained once as `state.json.v1.bak`.

The SDK exposes no documented Task idempotency key or Task listing surface. A process killed after a Task create succeeds but before its returned ID is saved—or a successful response lost in transit—can therefore create one orphaned finite Task. The command lease and disabled automatic retries prevent concurrent or implicit duplicates but cannot close that narrow remote-acknowledgement crash window.

## Customize the policy

Only the API key is required. Two environment variables expose optional controls:

```dotenv
MONITOR_FREQUENCY=1d
FOLLOW_UP_RISK_THRESHOLD=HIGH
```

`MONITOR_FREQUENCY` accepts hours, days, or weeks from `1h` through `30d`. `FOLLOW_UP_RISK_THRESHOLD` accepts `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`.

The six risk dimensions live in one `RISK_DIMENSIONS` registry in [`src/schema.ts`](src/schema.ts). That registry drives prompt descriptions, runtime validation, Task JSON Schema, policy iteration, and citation grouping. Aggregate risk and human guidance live in [`src/risk-policy.ts`](src/risk-policy.ts); Parallel supplies researched evidence, while deterministic code owns organizational policy.

## Verify the current API contract

The normal suite is deterministic and makes no API calls:

```bash
npm run validate
npm audit --audit-level=high
```

`validate` type-checks source, scripts, fixtures, and tests before running the suite.

The opt-in live test exercises the production `VendorIntelligence` lifecycle. It creates a real `core` Task and `lite` snapshot Monitor, checks for updates, invokes state-owned cleanup in `finally`, and independently confirms remote cancellation:

```bash
npm run test:live
```

The live test consumes credits. It does not wait for a real material change; deterministic fixtures cover that branch.

## Production extensions

Production systems can replace polling with webhooks, use event-stream Monitors for open-ended discovery, batch large portfolios with Task Groups, move state to a database, and route high-risk results to Slack or a ticketing system. Those are extensions, not additional execution paths in this recipe.

## License

[MIT](LICENSE)
