# Parallel Procurement: AI-Powered Vendor Risk Monitoring

## The Problem No One Talks About

Your company depends on vendors. Dozens of them. Maybe hundreds.

One of those vendors will have a bad day. A data breach. A lawsuit. A CEO resignation. A credit downgrade. It happens constantly. The question is whether you find out before it affects you or after.

Most teams find out after. They learn about it from a news article. A client mentions it on a call. Someone stumbles across a headline on LinkedIn. By that point, the damage is already unfolding.

This isn't a failure of effort. It's a failure of infrastructure. The tools don't exist to watch every vendor, across every risk dimension, every day. So teams default to quarterly reviews. They open a spreadsheet, assign a few analysts, and spend weeks manually researching vendors one by one. By the time the spreadsheet is complete, the findings are already stale.

Here's what that looks like in practice:

**The research doesn't scale.** A single vendor risk assessment takes 2-4 hours of analyst time. That's reading news coverage, checking regulatory databases, scanning financial filings, reviewing cybersecurity disclosures. At 50 vendors, that's 100-200 hours per quarter. At 200 vendors, it's a full-time job for multiple people. Most teams don't have those people.

**The scoring is inconsistent.** Analyst A reads the same news as Analyst B and reaches a different conclusion. There's no shared rubric. No standard severity framework. No way to compare one vendor's risk profile to another's. The scoring reflects who did the work, not what the data says.

**The alerts don't exist.** Between review cycles, nothing happens. No one is watching. A vendor could file for bankruptcy on a Tuesday and the team wouldn't know until the next quarterly review. That's not a gap. That's a canyon.

**The audit trail is a myth.** When the board asks "how do we monitor vendor risk?" the answer is usually a spreadsheet with last quarter's date on it. There's no continuous record. No timestamps. No traceability from finding to classification to action.

**Knowledge walks out the door.** The analyst who spent three years building vendor relationships and institutional knowledge leaves. Their context leaves with them. The next person starts from scratch.

The result is predictable. Risk events get caught late. Responses are reactive. The organization absorbs losses that were preventable. Financial losses. Legal exposure. Reputational damage. Operational disruption. All because no one was watching.

---

## What Parallel Procurement Does

Parallel Procurement replaces the quarterly vendor review spreadsheet with an always-on intelligence operation.

It watches your entire vendor portfolio. Every day. Across six risk dimensions. It scores every finding using consistent, transparent rules. It routes alerts to the right people in Slack. It logs every assessment for audit. It does this automatically, without human intervention, for as many vendors as you have.

The system has five capabilities that work together as a pipeline.

### What changes for your team

| Before | After |
|--------|-------|
| Research a vendor manually in 2-4 hours | AI research report in minutes |
| Review vendors quarterly | Daily research cycles + continuous real-time monitoring |
| Risk scored subjectively by whoever is available | Deterministic rules applied the same way every time |
| Alerts are ad-hoc (someone notices and pings the team) | Structured alerts routed by severity to dedicated channels |
| Audit trail is a spreadsheet with last quarter's date | Every assessment logged with timestamp, rationale, and source |
| 50 vendors is the practical ceiling | 3,000+ vendors with the same team and infrastructure |

The difference is operational. Your team stops spending time collecting information and starts spending time acting on it.

---

## How It Works

The system runs as a single automated workflow. You import it into n8n, connect your credentials, and activate it. From that point on, it operates independently. Here's what happens inside.

### 1. Vendor Sync

Your team maintains a Google Sheet. One tab. Six columns. Vendor name, website, category, priority level, active flag, and an optional risk override.

That's the entire input surface. Everything else is automated.

Every few hours, the system reads this sheet. It compares the current list against its internal registry. It computes a diff. It figures out exactly what changed.

A new row appeared? The system recognizes a new vendor. It deploys a tailored set of monitors for that vendor through Parallel AI's Monitor API. The number and type of monitors depend on the vendor's priority level. High-priority vendors get five monitors across five risk dimensions. Medium-priority vendors get three. Low-priority vendors get two.

A row was removed? The system deletes all associated monitors. No orphaned resources. No manual cleanup.

A vendor's priority changed from low to high? The system removes the old monitor set and deploys a new one with broader coverage and higher cadence. The vendor is now being watched more closely. This happens without anyone asking.

A vendor's category changed? Logged. An override was added? Respected in all future scoring. The diff engine tracks every change type: additions, removals, modifications of priority, category, override, and active status.

The registry tab in Google Sheets is updated with the current state. Monitor IDs are recorded. Sync timestamps are written. The system always knows what it's watching and why.

### 2. Deep Research

Once a day, at 2 AM UTC, the research engine wakes up.

It reads the registry. It filters for vendors that are due for research. Each vendor has a `next_research_date` field. If that date has passed, the vendor goes into the research queue. If the field is empty, the vendor is included immediately. Inactive vendors are skipped.

The due vendors are split into batches. Each batch contains up to 50 vendors. Each batch is submitted to Parallel AI's Task API as a Task Group.

For every vendor in the batch, the system sends a structured research prompt. The prompt asks Parallel AI to investigate six risk dimensions:

**Financial Health.** Is the company financially stable? Look at revenue trends, credit ratings, debt levels, liquidity, bankruptcy risk, funding status, and credit downgrades. Are there signs of financial distress?

**Legal and Regulatory.** Is the company facing legal trouble? Look at active lawsuits, regulatory enforcement actions, SEC investigations, sanctions exposure, OFAC listings, and compliance violations. Is there pending litigation that could materially impact operations?

**Cybersecurity.** Has the company been breached? Look at data breach history, vulnerability disclosures, ransomware incidents, SOC 2 certification status, ISO 27001 compliance, and penetration test findings. What is the company's security posture?

**Leadership and Governance.** Is the leadership stable? Look at executive turnover, CEO departures, board reshuffles, activist investor activity, mergers and acquisitions, and governance controversies. Are there signs of organizational instability?

**ESG and Reputation.** Is the company a reputational risk? Look at environmental violations, labor disputes, workplace safety issues, product recalls, public controversies, ESG rating changes, and media sentiment. Are there issues that could reflect poorly on your organization by association?

**Adverse Events.** Is there breaking news? Look at any sudden material changes, emergency disclosures, or negative developments that don't fit neatly into the five dimensions above. This is the catch-all for things that just happened.

Parallel AI researches each dimension across public sources. It doesn't run keyword searches. It doesn't clip headlines. It synthesizes information from news coverage, regulatory filings, financial databases, security advisories, and other public records. It returns a structured JSON report with status assessments, finding summaries, severity ratings, source URLs, and an overall recommendation.

The system polls the Task API until all runs complete. Failed runs don't block the batch. The system collects what succeeded and moves on. Failed vendors keep their existing `next_research_date` so they'll be picked up again in the next cycle. Nothing is lost.

Completed results are parsed, scored, routed to Slack, and logged. The `next_research_date` for each successful vendor is advanced by 7 days. The rotation continues indefinitely.

### 3. Risk Scoring

Every research result passes through a scoring engine before anything is sent to Slack or logged.

This engine is entirely rule-based. It is not AI. It does not use machine learning. It does not hallucinate. It applies a fixed set of deterministic rules to the structured research output and produces a classification.

The rules are straightforward.

**Severity aggregation.** The engine reads the severity rating from each of the five risk dimensions. It counts how many are CRITICAL, HIGH, MEDIUM, and LOW.

**Risk level assignment.** Based on those counts:

- If any dimension is rated CRITICAL, the vendor is classified **CRITICAL**. Adverse flag is set.
- If one or more dimensions are rated HIGH, the vendor is classified **HIGH**. Adverse flag is set.
- If three or more dimensions are rated MEDIUM and they span at least two different categories, the vendor is classified **MEDIUM** with adverse conditions.
- If one or two dimensions are rated MEDIUM, the vendor is classified **MEDIUM** without adverse conditions.
- If all dimensions are rated LOW, the vendor is classified **LOW**. No adverse flag. No escalation.

**Override rules.** Three overrides are applied after the base scoring:

1. If the cybersecurity dimension has a status of CRITICAL (indicating an active data breach), the vendor is forced to CRITICAL regardless of the base score.
2. If the legal/regulatory dimension has a status of CRITICAL (indicating active government litigation), the vendor is forced to at least HIGH.
3. If the vendor has a `risk_tier_override` set in the Google Sheet, that value acts as a floor. The system will never score the vendor lower than the override. A vendor with an override of HIGH will never be classified as MEDIUM or LOW, even if the research finds nothing concerning.

**Recommendation mapping.** Each risk level maps to a specific recommendation:

- **LOW** maps to `continue_monitoring`. Keep watching. No action needed.
- **MEDIUM** maps to `escalate_review`. Bring this vendor to the attention of the review committee.
- **HIGH** maps to `initiate_contingency`. Begin activating backup plans. Identify alternative vendors.
- **CRITICAL** maps to `suspend_relationship`. Consider immediately pausing or terminating the vendor relationship.

The `action_required` flag is set to `true` for HIGH and CRITICAL. This flag drives whether the alert goes to the critical channel or the digest.

Every scoring decision is traceable. The output includes the exact severity counts, which categories triggered the classification, which overrides fired, and a human-readable summary. When someone asks "why is this vendor flagged CRITICAL?" the answer is in the data.

### 4. Continuous Monitoring

The daily research cycle is comprehensive but periodic. It runs once a day. Events don't wait for schedules.

That's where monitors come in.

When a vendor is added to the system, the Vendor Sync process deploys a set of persistent monitors through Parallel AI's Monitor API. Each monitor watches for a specific type of event related to that vendor. The monitors run continuously. They don't wait for a cron job.

Each monitor has a search query tailored to the vendor and risk dimension. For example, a legal monitor for Acme Corp runs a query like: `"Acme Corp" lawsuit OR litigation OR regulatory action OR SEC investigation OR enforcement`. A cybersecurity monitor runs: `"Acme Corp" data breach OR cybersecurity incident OR ransomware OR vulnerability disclosure`.

There are five query templates. Each covers one risk dimension:

| Dimension | What it watches for |
|-----------|-------------------|
| Legal & Regulatory | Lawsuits, litigation, regulatory actions, SEC investigations, enforcement |
| Cybersecurity | Data breaches, ransomware, vulnerability disclosures, security incidents |
| Financial Health | Bankruptcy, financial distress, credit downgrades, debt defaults, layoffs |
| Leadership & Governance | CEO departures, executive changes, acquisitions, mergers |
| ESG & Reputation | Recalls, safety violations, environmental fines, labor disputes, ESG controversies |

Not every vendor gets all five. The allocation depends on priority:

| Priority | Monitors | Cadence |
|----------|----------|---------|
| High | All 5 dimensions | Daily |
| Medium | Legal, Cyber, Financial | Daily |
| Low | Legal, Financial | Weekly |

High-priority vendors get the broadest coverage at the highest frequency. Low-priority vendors get the essentials at a lower cadence. This keeps the monitor portfolio efficient without leaving gaps.

When a monitor detects a relevant event, Parallel AI sends a webhook to the system. The system receives the event, enriches it with vendor context from the registry, and checks it against a deduplication cache.

The dedup cache prevents alert fatigue. Its key is a combination of vendor domain, event type, and severity. If the same event has been seen within the last 24 hours, it's skipped. This matters because a major news story often triggers multiple monitors for the same vendor. Without dedup, a single data breach could generate five separate alerts. With dedup, it generates one.

Events that pass the dedup check are scored through the same risk scoring engine used for deep research. The scored event is routed to Slack and logged to the audit trail.

The monitor fleet is self-healing. Every day at 6 AM, a health checker runs. It lists all active monitors. It cross-references them against the vendor registry. It identifies orphans -- monitors whose vendor is no longer active. It identifies failures -- monitors that are no longer running. It deletes orphans. It recreates failed monitors with the same configuration. It pings the webhook endpoint to verify it's reachable. It sends a health report to the ops channel with counts: total monitors, active, failed, orphaned, recreated, webhook status.

No one has to maintain the monitor fleet. It maintains itself.

### 5. On-Demand Research

Sometimes you can't wait for the daily cycle.

A contract is being negotiated. The board wants a risk assessment on a potential acquisition target. A client asks about the security posture of a subprocessor. Legal needs a quick check on a vendor before signing an amendment.

The system provides a Slack slash command: `/vendor-research [company name or domain]`.

Type it in any channel. The system acknowledges immediately: "Starting deep research. This typically takes 15-30 minutes." Then it fires a single research task to Parallel AI with the same prompt and output schema used in the daily batch research. When the result comes back via webhook, the system scores it, formats a full report, and posts it as a thread reply in the channel where you asked.

The report includes the risk level, the adverse flag, the recommendation, severity breakdowns across all five dimensions, which categories triggered the classification, and the full assessment summary.

This turns every Slack channel into a vendor intelligence terminal. Any team member can run a research query at any time. No portal. No ticket. No waiting for the next quarterly review.

---

## Alert Routing

Not every finding needs the same response. A vendor sliding into moderate financial difficulty is different from a vendor disclosing an active data breach. The system treats them differently.

Alerts are routed to four Slack channels based on the scoring engine's classification.

**#procurement-critical** receives CRITICAL and HIGH alerts. These are immediate. They arrive in real time with full detail: which vendor, what was found, which risk dimensions are affected, what the recommendation is. CRITICAL alerts carry a 24-hour review deadline. HIGH alerts carry 48 hours. This is the channel your incident response team watches.

**#procurement-alerts** receives standard notifications. Monitor event alerts for non-critical findings. Vendor onboarding confirmations. Status updates. These are important for awareness but don't require immediate action.

**#procurement-digest** receives the weekly summary. MEDIUM-risk findings are not sent individually. They're batched and delivered as a digest, grouped by risk level, with total vendor counts and adverse finding summaries. This prevents the medium-severity noise that causes teams to mute channels and miss the important stuff.

**#vendor-risk-ops** is the operations channel. It receives health check reports (how many monitors are active, how many failed, how many were recreated). It receives research run summaries (how many vendors were due, how many succeeded, how many failed, how many adverse findings). It receives error notifications when something breaks. This channel is for the team running the system, not the team consuming the intelligence.

The routing is automatic. The scoring engine determines the destination. No human triage. No forwarding. No copy-pasting between channels.

---

## The Audit Trail

Every assessment the system produces is logged. Every single one.

Scheduled research results. Real-time monitor events. Ad-hoc slash command reports. All of them write an entry to the Audit Log tab in Google Sheets.

Each entry contains:

- **Timestamp.** When the assessment was produced. ISO 8601 format. Precise to the second.
- **Vendor name.** Which vendor was assessed.
- **Risk level.** The classification assigned: LOW, MEDIUM, HIGH, or CRITICAL.
- **Adverse flag.** Whether adverse conditions were detected.
- **Categories.** Which risk dimensions triggered the classification. Comma-separated.
- **Summary.** A human-readable narrative of the assessment.
- **Run ID.** The Parallel AI task group or event group identifier. Traceable back to the source data.
- **Source.** Whether the assessment came from `deep_research` (scheduled or ad-hoc) or `monitor_event` (real-time detection).

This audit trail is not optional. It's not a feature you turn on. It's built into the pipeline. Every path through the system -- research, monitoring, ad-hoc -- writes to the same log with the same fields.

Why this matters:

**Regulatory compliance.** SOC 2, ISO 27001, NIST CSF, and most procurement governance frameworks require documented evidence of continuous vendor risk assessment. This audit trail provides it. Every vendor, every assessment, every timestamp, every rationale. The record is complete and continuous, not quarterly snapshots.

**Trend analysis.** When a vendor's risk level changes over time, you can see it. The log shows when a vendor moved from LOW to MEDIUM, when it jumped to HIGH, when it came back down. Patterns emerge. A vendor that repeatedly triggers medium-severity findings across multiple dimensions may warrant a conversation even if no single finding crosses the threshold.

**Accountability.** When a stakeholder asks "who flagged this vendor?" the answer isn't a person. It's a system with traceable rules. The scoring engine applied rule X because dimension Y had severity Z. The override fired because the vendor's cybersecurity status was CRITICAL. The trail is complete. The logic is reproducible. The same input produces the same output every time.

**Institutional knowledge.** People leave. Teams restructure. Analysts rotate. The audit trail doesn't. Three years from now, you can look up every assessment ever made for a vendor. The context doesn't walk out the door.

---

## Why This Approach Works

### It's a system, not a tool

Most vendor risk products give you a dashboard. You log in, you look at data, you make decisions. That model requires humans to check the dashboard. Humans forget. Humans get busy. Dashboards go stale.

Parallel Procurement is different. It runs without you. Research happens on schedule. Monitors watch in real time. Alerts fire automatically. The audit trail writes itself. The system does the work. Your team does the thinking.

The value isn't in the interface. There is no interface. The value is in the pipeline that runs 24/7 and only surfaces what requires human attention.

### It lives where your team works

The entire output surface is Slack. Your team already has Slack open. They already read channels. They already respond to notifications.

There is no new application. No portal to bookmark. No login to remember. No browser tab to keep open. Critical alerts appear in the channel your team watches. On-demand research is a slash command. The system is invisible until it has something to say.

This matters for adoption. Tools that require behavior change fail. Tools that meet people where they already are succeed.

### It scales without effort

Adding a vendor takes 30 seconds. Open the Google Sheet. Type a name, a domain, a category, and a priority. Save. The system picks it up on the next sync cycle. Monitors are deployed. Research is scheduled. Alerts are routed. No configuration. No onboarding workflow. No capacity planning.

Removing a vendor is the same. Delete the row. The system cleans up monitors, stops research, and moves on.

The system handles 15 vendors the same way it handles 3,000. The infrastructure doesn't change. The team doesn't change. The cost scales linearly with the number of vendors, not exponentially.

### Scoring is deterministic

This is a deliberate design choice.

AI is excellent at research. It synthesizes information from thousands of sources, identifies relevant findings, and structures them into a coherent report. That's the hard part. That's where Parallel AI adds value.

But risk classification is a policy decision. It should be consistent. It should be auditable. It should be explainable to a board of directors.

The scoring engine uses fixed rules. Any CRITICAL dimension means the vendor is CRITICAL. Any HIGH dimension means the vendor is HIGH. Three or more MEDIUM dimensions across two categories means MEDIUM with adverse. These rules don't change based on who's running the system or what day it is.

When a stakeholder asks "why was this vendor flagged?" the answer is traceable. Dimension X had severity Y. Override Z was triggered. The recommendation follows from the risk level. There is no black box. There is no "the AI decided."

This separation -- AI for research, rules for scoring -- gives you the best of both worlds. Intelligence at scale. Governance you can trust.

### It runs on commodity infrastructure

The system is built on three services you probably already have:

- **Google Sheets** for the vendor registry, audit log, and monitor tracking. No database. No migrations. No DBA.
- **Slack** for alerts, digests, and on-demand research. No custom UI. No frontend to deploy.
- **n8n** for workflow orchestration. Open source. Self-hostable. Or use n8n Cloud.

Parallel AI provides the intelligence layer -- the research and monitoring capabilities. Everything else is standard, inspectable, and replaceable.

There is no proprietary platform. No vendor lock-in on the orchestration layer. The workflows are importable JSON files. You can read them, modify them, extend them, or rewrite them. The Google Sheet is a Google Sheet. The Slack messages are Slack messages. Nothing is opaque.

### It maintains itself

The monitor fleet runs a daily health check. It finds monitors that stopped working and recreates them. It finds monitors for vendors that are no longer active and deletes them. It pings its own webhook endpoint to make sure it's reachable. It reports the results to the ops channel.

The research orchestrator tracks failures and sends run summaries when things go wrong. If a batch has failures or adverse findings, the ops channel gets a notification with counts and details.

Failed vendors aren't dropped. Their research dates aren't advanced. They stay in the queue and get picked up again on the next cycle.

The system degrades gracefully and recovers automatically. It doesn't need babysitting.

---

## Who Should Use This

**Procurement teams with 20+ vendors.** You've outgrown the quarterly spreadsheet. You need continuous coverage but don't have the headcount to do it manually. This system automates the research and gives your analysts time back to focus on the vendors that actually need human attention.

**Third-party risk management teams.** Your regulatory framework requires continuous vendor monitoring. SOC 2 auditors want to see evidence of ongoing assessment, not a snapshot from three months ago. This system provides that evidence automatically, with a complete audit trail.

**Security teams worried about supply chain risk.** You've seen what happens when a vendor gets breached and you find out from Twitter. Real-time monitors catch these events as they happen. Alerts hit Slack in minutes, not days.

**Finance leaders managing vendor concentration risk.** A critical supplier's financial distress can disrupt your operations before you know it's happening. Weekly financial health monitoring across every vendor gives you early warning.

**Any organization that's been surprised by a vendor.** A breach you learned about from the press. A bankruptcy that disrupted deliveries. A regulatory action that created legal exposure. If any of these have happened to you, the cost of not monitoring is already clear. This system exists so it doesn't happen again.

---

## Getting Started

Setup takes 30 minutes. You need three accounts:

1. **Parallel AI** -- provides the research and monitoring intelligence
2. **Google** -- for the vendor registry and audit log (any Google account)
3. **Slack** -- for alerts and on-demand research (admin access to create channels)

The system ships with everything pre-built:

- **A single combined workflow** (56 nodes, zero cross-workflow wiring) ready to import into n8n
- **Google Sheets templates** with 15 seed vendors across five industries so you can test immediately
- **A step-by-step setup guide** covering credential configuration, environment variables, and activation testing

Import the workflow. Connect your credentials. Set four environment variables. Activate. Run the first sync manually. Watch the Registry tab populate. Watch Slack light up.

You'll have vendor risk intelligence running within the hour.

---

## Positioning Summary

### One-liner

Automated vendor risk intelligence that watches your supply chain continuously, scores risk consistently, and delivers actionable alerts to Slack.

### Elevator pitch

Parallel Procurement replaces quarterly vendor reviews with continuous AI-powered monitoring. It researches every vendor in your portfolio across six risk dimensions. It scores findings using transparent, deterministic rules. It routes alerts to Slack by severity. It maintains a complete audit trail for compliance.

Your team goes from reactive to proactive. From learning about vendor problems on the news to catching them as they develop. From quarterly spreadsheets to daily intelligence. From inconsistent analyst judgment to reproducible, auditable scoring.

Setup takes 30 minutes. It scales from 15 vendors to 3,000 with no additional effort. It runs autonomously after activation.

### Key differentiators for sales conversations

1. **Time to value.** 30-minute setup. First results within the hour. No implementation project. No professional services engagement. No 6-month rollout. Import a workflow, connect three credentials, press play.

2. **Research depth.** Six risk dimensions per vendor, synthesized from across the web by Parallel AI. This is not keyword alerting. Not news clipping. Not a Google Alert. It's structured, sourced intelligence with severity ratings and recommendations.

3. **Deterministic scoring.** Rules-based risk classification. Auditable. Explainable. Reproducible. When a procurement leader asks why a vendor was flagged, the answer is traceable to specific findings and specific rules. No black box.

4. **Dual coverage model.** Scheduled deep research (comprehensive, periodic, daily) plus continuous monitoring (real-time, event-driven, always on). Most solutions offer one or the other. This system does both, through the same scoring engine, into the same audit log.

5. **Slack-native delivery.** Zero adoption friction. Alerts, digests, on-demand research, and ops notifications all happen in Slack. No new tool to deploy. No training. No behavior change.

6. **Transparent infrastructure.** Built on Google Sheets + n8n + Slack. No proprietary platform. No database to manage. Fully inspectable, fully extensible. The workflows are JSON files you can read.

7. **Self-healing operations.** Monitor health checks. Automatic orphan cleanup. Failed monitor recreation. Research retry on failure. Error reporting to ops. The system maintains itself.

### Target buyer personas

| Persona | Their pain | Your message |
|---------|-----------|-------------|
| **VP of Procurement** | "We can't research 200 vendors quarterly with 3 analysts." | Automate the research. Your team focuses on decisions, not data collection. 200 vendors researched daily, automatically. |
| **Chief Risk Officer** | "We need continuous monitoring for SOC 2 / regulatory compliance." | Every vendor assessed on schedule. Complete audit trail. Continuous, not periodic. Auditor-ready from day one. |
| **Head of IT / Security** | "We found out about our vendor's breach from Twitter." | Real-time monitors catch events as they happen. Alerts hit Slack in minutes. Not days. Not quarters. Minutes. |
| **CFO / COO** | "A supplier bankruptcy caught us off guard and disrupted operations." | Financial health monitoring across every vendor, every week. Early warning before distress becomes disruption. |

### Competitive positioning

| Traditional TPRM platforms | Parallel Procurement |
|---------------------------|---------------------|
| 3-6 month implementation | 30-minute setup |
| $50K-$500K annual contracts | Pay-per-use AI research |
| Annual or quarterly assessments | Daily research + continuous monitoring |
| Portal-based (another tool to check) | Slack-native (alerts come to you) |
| Proprietary risk scores (black box) | Transparent, rule-based scoring |
| Requires dedicated risk team to operate | Runs autonomously after activation |
| Static questionnaire-based assessments | AI-synthesized web intelligence |
| Manual vendor onboarding | Add a row to a spreadsheet |
| No real-time detection | Persistent monitors with webhook alerting |
| Audit trail requires export/configuration | Every assessment logged automatically |
