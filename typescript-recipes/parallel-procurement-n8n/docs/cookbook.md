# Building a vendor intelligence system with Parallel

Enterprises are using Parallel Web Systems to watch their entire vendor portfolio. This guide walks through building a vendor intelligence operating surface that turns continuous Parallel Task API and Monitor API output into a single feed for procurement, security, and third-party risk teams. The system combines periodic deep research with always-on monitors, deterministic risk scoring, and a portfolio view across hundreds of vendors.

**Tags:** Cookbook · **Reading time:** 5 min · [Try it] · [GitHub]

---

## See the system at a glance

Two diagrams accompany this guide and the rest of the essay refers to them by name:

- **Diagram 1 — *Vendor Intelligence System: How It Works*** ([`vendor-intelligence-system.excalidraw`](../vendor-intelligence-system.excalidraw)) — the end-to-end research flow from the vendor registry through n8n workflows, Parallel APIs, the risk scoring engine, and out to Slack and the audit log.
- **Diagram 2 — *Self-Healing Monitor Fleet*** ([`self-healing-monitor-fleet.excalidraw`](../self-healing-monitor-fleet.excalidraw)) — the daily reconciliation loop that keeps the monitor fleet aligned with the registry.

---

## What your team gets

Three things change for an analyst once the system is live:

- **Slack becomes the vendor intelligence terminal.** Severity-routed channels surface CRITICAL and HIGH risks immediately, MEDIUM risks land in alerts or the weekly digest, and ops health goes to a separate ops channel. The analyst never triages a queue — the scoring engine routes everything.
- **`/vendor-research <company name or domain>`** triggers a deep research run on any vendor on demand, scored and returned in-thread.
- **An audit log captures every assessment.** Scheduled research, monitor events, and ad-hoc slash commands all write timestamped entries with run ID, dimensions, severity, and rationale. Any flag can be reconstructed on any date.

---

## How it works

The system is five n8n workflows that share one risk scoring engine. **See Diagram 1.**

- **Vendor Portfolio Sync** keeps Parallel monitors aligned with a Google Sheets vendor registry. New vendors get monitors deployed; removed vendors get monitors deleted.
- **Daily Deep Research** batches the vendors whose `next_research_date` has passed and submits them to the Parallel Task Group API as a single request per batch.
- **Risk Scoring Engine** is a deterministic rule engine. Every Parallel result — scheduled, continuous, or on-demand — passes through it before anything reaches Slack or the audit log.
- **Monitor Events** receives webhooks from Parallel monitors, enriches them with registry context, deduplicates inside a 24-hour window, and feeds the scorer.
- **Ad-hoc Research** handles the `/vendor-research` slash command end to end: ack in Slack, run a single Task, score the result, thread the report back under the original message.

Parallel's research synthesizes news coverage, regulatory filings, financial databases, security advisories, and other public records into a structured report covering **five risk dimensions** — Financial Health, Legal & Regulatory, Cybersecurity, Leadership & Governance, ESG & Reputation — plus an **adverse-events feed** for breaking material developments that don't fit a single dimension.

---

## Design patterns

**Two clocks, one scorer.** Deep research runs once a day with Parallel's deep-research processor[^1] and produces a comprehensive structured report per vendor. Monitors run continuously and emit events as they happen. The same scoring engine evaluates both streams and the dashboard merges them into a single feed.

**Deterministic scoring on top of synthesized intelligence.** The JSON output from the Task API synthesizes thousands of sources into a structured report with severity per dimension. A fixed rule engine turns that report into a LOW / MEDIUM / HIGH / CRITICAL classification with traceable rationale. Stakeholders can ask why a vendor was flagged and get an answer that points at the dimensions and overrides that drove the decision. The output is reproducible across runs.

---

## Self-healing monitor fleet

The monitor fleet is a managed resource, not a one-time deployment. Every day, a health check lists active monitors, cross-references them against the vendor registry, deletes orphans, recreates missing coverage, and pings the webhook endpoint. Operators receive a single summary post in `#vendor-risk-ops` instead of reactive incidents.

**See Diagram 2.**

---

## Risk scoring rules

Every Parallel result — scheduled research, monitor event, or ad-hoc slash command — passes through the same scoring engine before anything reaches Slack or the dashboard. The engine is rule-based on purpose. Research is where AI earns its keep. Classification is a policy decision and needs to be reproducible.

```ts
function score(report: VendorReport, override?: RiskLevel): RiskAssessment {
  const counts = countSeverities(report.dimensions);
  let level: RiskLevel = "LOW";
  let adverse = false;

  if (counts.CRITICAL >= 1) {
    level = "CRITICAL";
    adverse = true;
  } else if (counts.HIGH >= 1) {
    level = "HIGH";
    adverse = true;
  } else if (counts.MEDIUM >= 3 && spansCategories(report.dimensions, 2)) {
    level = "MEDIUM";
    adverse = true;
  } else if (counts.MEDIUM >= 1) {
    level = "MEDIUM";
  }

  // Overrides apply after the base classification.
  if (report.cybersecurity.status === "CRITICAL") level = "CRITICAL";
  if (report.legal_regulatory.status === "CRITICAL" && level === "LOW") {
    level = "HIGH";
  }
  if (override) level = floor(level, override);

  return {
    level,
    adverse,
    recommendation: RECOMMENDATIONS[level],
    triggered: triggeredCategories(report, level),
  };
}
```

Recommendations follow directly from the level: LOW maps to `continue_monitoring`, MEDIUM to `escalate_review`, HIGH to `initiate_contingency`, CRITICAL to `suspend_relationship`. The `triggered` array captures which dimensions and overrides drove the decision so the dashboard can render the rationale next to the score.

The rules are a policy decision. The AI does its work upstream — in the synthesis that turns thousands of public sources into a structured per-dimension report. By the time the result hits the scorer, the judgment is deterministic.

---

## Slack delivery

The dashboard exists for analysts who want to dig into a vendor. The day-to-day delivery surface is Slack. The scoring engine routes alerts by severity and never asks a human to triage.

```ts
function route(assessment: RiskAssessment) {
  if (assessment.level === "CRITICAL") {
    return { channel: "#procurement-critical", deadline: "24h" };
  }
  if (assessment.level === "HIGH") {
    return { channel: "#procurement-critical", deadline: "48h" };
  }
  if (assessment.level === "MEDIUM" && assessment.adverse) {
    return { channel: "#procurement-alerts" };
  }
  if (assessment.level === "MEDIUM") {
    return { channel: "#procurement-digest", batch: "weekly" };
  }
  return { channel: null }; // log only
}
```

The same severity tags drive the dashboard. CRITICAL and HIGH vendors land on the Attention queue with a deadline. MEDIUM goes to the Portfolio table with an adverse flag if the rule fires. LOW is logged silently and visible in Portfolio for completeness.

---

## Ad-hoc research from Slack

`/vendor-research <company name or domain>` posts an immediate ack (*"Starting deep research, this typically takes 15-30 minutes"*), fires a single-run Task with the same prompt and schema as the daily batch, and threads the scored report under the original message when results return. The assessment writes to the audit log with `source: adhoc`, so the dashboard's vendor detail page treats it identically to a scheduled run.

---

## Audit trail

Because every source — scheduled research, monitor event, ad-hoc slash command — funnels through the same scorer and lands in the same audit log, you can reconstruct *why* a vendor was flagged on any date without re-running anything. Each row carries the timestamp, vendor, risk level, source, triggered dimensions, run ID, and top citations. Compliance, forensics, and BI all read from the same stream.

---

## Resources

- Live demo
- Complete source code on GitHub (Task Group submission and Monitor creation snippets live there in full)
- [Parallel Task API](https://parallel.ai/docs/task-api)
- [Parallel Task Group API](https://parallel.ai/docs/task-group-api)
- [Parallel Monitor API](https://parallel.ai/docs/monitor-api)
- [Parallel Deep Research](https://parallel.ai/docs/deep-research)

---

[^1]: Parallel exposes a tiered set of processors (`lite`, `base`, `core`, `pro`, `ultra` and their `-fast` variants, plus the highest-recall `ultra8x` used here for deep research). Daily batches use `ultra8x` for maximum recall; monitor evaluations and ad-hoc Slack runs use the same processor for consistency. See the GitHub repo for the full processor configuration.
