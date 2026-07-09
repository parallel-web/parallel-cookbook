# Vendor intelligence article handoff

This document is the technical source of truth for the Copytree article. Copy concepts and short excerpts from the linked compiling source; do not maintain a second implementation in the article.

## Final narrative

The article should show how a developer can replace periodic manual vendor reviews with a small, repeatable intelligence loop:

1. Run one structured Task to establish a cited vendor-risk baseline.
2. Apply deterministic organizational risk policy to the evidence.
3. Create one snapshot Monitor from that structured Task.
4. Poll Monitor events locally and process each stable event ID once.
5. Run a focused investigation only when a changed field crosses policy.
6. Persist citations, policy reasons, and human guidance for review.

This is a reference pattern derived from a customer use case. It is not a claim that Parallel currently runs this vendor-management system internally.

## Required scope corrections

The tutorial ships local TypeScript scripts and a diagram. n8n, a hosted dashboard, Vercel, Supabase, authentication, Google Sheets, Slack commands, the Observe UI, and a hosted live demo are not required or implemented surfaces. If mentioned, they must be clearly labeled as possible production extensions.

Use the current official TypeScript SDK and V1 Task and Monitor APIs. Remove placeholder alpha/beta endpoint calls and any snippet that depends on helpers absent from the published source.

## Compiling snippet sources

- Vendor input and the six risk dimensions: [`RISK_DIMENSIONS`, `VendorSchema`, and `VendorReportSchema`](../src/schema.ts).
- Baseline Task contract: [`buildBaselineTaskParams`](../src/schema.ts).
- Baseline lifecycle and snapshot Monitor creation: [`VendorIntelligence.bootstrap`](../src/vendor-intelligence.ts). The canonical Monitor block calls `client.monitor.create` with `type: "snapshot"` and `settings.task_run_id` set to the completed baseline run.
- Snapshot reconstruction and evidence replacement: [`reconstructSnapshotEvent`](../src/vendor-intelligence.ts).
- Event pagination, durable deduplication, and focused follow-ups: [`VendorIntelligence.checkForUpdates`](../src/vendor-intelligence.ts).
- Aggregate risk and human guidance: [`scoreReport`](../src/risk-policy.ts).
- Material-change decision: [`decideFollowUp`](../src/risk-policy.ts). There is intentionally no separate `shouldInvestigateChange` helper.
- Focused follow-up contract: [`buildChangeInvestigationTaskParams`](../src/schema.ts).
- Atomic local audit state: [`FileStateStore`](../src/state.ts).
- State-owned cancellation: [`VendorIntelligence.cleanup`](../src/vendor-intelligence.ts).

The snapshot assessment is re-scored before the materiality decision. The follow-up Task adds confirmed facts, business impact, and open questions; it does not own the final risk level or human action.

## Diagram and commands

Use [`vendor-intelligence-flow.svg`](vendor-intelligence-flow.svg) in the article. Its editable source is [`vendor-intelligence-flow.mmd`](vendor-intelligence-flow.mmd).

The public lifecycle is:

```bash
npm ci
npm run bootstrap
npm run check-updates
npm run cleanup
```

The deterministic verification commands are:

```bash
npm run check
npm test
npm run build
npm audit --audit-level=high
```

`npm run test:live` is opt-in, consumes credits, creates a real baseline Task and disposable snapshot Monitor, and verifies Monitor cancellation. A real material change is nondeterministic, so the article should identify fixture tests—not the live probe—as proof of the change-to-follow-up branch.

## Production-extension wording

Suggested language:

> This local recipe polls Monitor events so it runs without hosted infrastructure. A production system could receive webhooks, use event-stream Monitors for broader discovery, batch larger portfolios with Task Groups, store state in a database, and route high-risk assessments into existing review tools.

Keep extensions brief. The article's call to action is to clone the recipe, run the three-command lifecycle, and adapt the dimensions and deterministic policy.
