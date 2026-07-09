# Parallel vendor intelligence

This recipe is a scripts-first example of vendor enrichment and monitoring. It establishes a cited structured baseline, creates one snapshot Monitor per vendor, records detected changes locally, and runs focused follow-up research when your deterministic risk policy calls for it.

The monitored assessment intentionally has six top-level risk fields plus `adverse_events`. Parallel Task basis and snapshot Monitor changes are reported by top-level field, so this shape keeps evidence, diffs, and policy aligned without a second query or schema system.

## Run it

```bash
npm install
npm run check
npm test
```

Copy `.env.example` to `.env`, add `PARALLEL_API_KEY`, then:

```bash
npm run bootstrap
npm run check-updates
npm run cleanup
```

`bootstrap` is resumable and reuses completed baselines and active Monitors. `check-updates` traverses the retained Monitor event history, processes unseen snapshot changes oldest-first, and persists enough context to resume an interrupted follow-up Task. `cleanup` only cancels Monitor IDs owned by the local state file.

The local audit trail is `.vendor-intelligence/state.json`. It is atomically replaced and runtime-validated, but it is intentionally a single-process cookbook store rather than a compliance database.

Only `PARALLEL_API_KEY` is required. `MONITOR_FREQUENCY` defaults to `1d`, and `FOLLOW_UP_RISK_THRESHOLD` defaults to `HIGH`.

## Run the disposable API probe

With the same `.env`, run:

```bash
npm run smoke:live
```

The probe creates one `core` Task for the public example vendor, validates the structured result, creates and retrieves a 30-day snapshot Monitor, lists its first event page, and cancels the Monitor in `finally`. It does not write the normal recipe state.
