import type { ObserveGraphSnapshot, ObserveNodeData, ObserveNodeType } from "@/lib/observe-types";

type NodeSeed = Pick<
  ObserveNodeData,
  | "id"
  | "type"
  | "state"
  | "title"
  | "subtitle"
  | "campaignId"
  | "vendorId"
  | "parentId"
  | "childIds"
  | "whyThisNodeExists"
  | "whatItIsDoing"
  | "spawnedBy"
  | "spawnedAt"
  | "spawnedChildren"
  | "cost"
  | "lifecycle"
  | "provenance"
  | "rulesEvaluation"
>;

const CAMPAIGN_ID = "campaign-procurement-risk-q1";

function typeLabel(type: ObserveNodeType) {
  return type.replaceAll("_", " ");
}

const nodes: NodeSeed[] = [
  {
    id: "campaign-seed",
    type: "campaign",
    state: "active",
    title: "Enterprise Vendor Risk Campaign",
    subtitle: "200 enterprise vendors, auto-investigate anomalies",
    campaignId: CAMPAIGN_ID,
    childIds: ["monitor-acme-sec", "monitor-acme-news", "monitor-acme-web", "monitor-acme-social"],
    whyThisNodeExists:
      "The operator started a campaign to continuously monitor enterprise vendors for risk signals and autonomously investigate anomalies.",
    whatItIsDoing: "Maintaining campaign budget, spawn policy, and active monitor topology.",
    spawnedAt: "2026-03-07T17:30:00.000Z",
    spawnedChildren: [
      { id: "monitor-acme-sec", type: "monitor", reason: "Seed monitor for SEC filing risk signals." },
      { id: "monitor-acme-news", type: "monitor", reason: "Seed monitor for negative news spikes." },
      { id: "monitor-acme-web", type: "monitor", reason: "Seed monitor for pricing and website changes." },
      { id: "monitor-acme-social", type: "monitor", reason: "Seed monitor for social and sentiment shifts." },
    ],
    cost: { actualUsd: 41.13, estimatedTotalUsd: 120, remainingBudgetUsd: 78.87 },
    lifecycle: {
      currentState: "active",
      lastTransitionAt: "2026-03-07T17:30:00.000Z",
      transitions: [{ state: "active", changedAt: "2026-03-07T17:30:00.000Z", reason: "Campaign launched." }],
    },
    provenance: { source: "adhoc", runId: "campaign-run-001", citations: [] },
    rulesEvaluation: {
      signalStrength: 1,
      threshold: 0.7,
      budgetGate: "pass",
      deduplication: "pass",
      rateLimit: "pass",
      depthLimit: "pass",
      scopeCheck: "pass",
      decision: "allowed",
      decisionReason: "Campaign root node established by operator intent.",
    },
  },
  {
    id: "monitor-acme-sec",
    type: "monitor",
    state: "triggered",
    title: "SEC Filing Watch",
    subtitle: "Acme Corp 8-K, 10-Q, governance filings",
    campaignId: CAMPAIGN_ID,
    vendorId: "acme",
    parentId: "campaign-seed",
    childIds: ["research-acme-exec-comp"],
    whyThisNodeExists: "Created during campaign seeding to track Acme SEC filing risk dimensions.",
    whatItIsDoing: "Scanning new filings and evaluating anomaly confidence against trigger threshold.",
    spawnedBy: { id: "campaign-seed", type: "campaign", reason: "Initial monitor seeding." },
    spawnedAt: "2026-03-07T17:30:06.000Z",
    spawnedChildren: [
      {
        id: "research-acme-exec-comp",
        type: "deep_research",
        reason: "Anomalous executive compensation filing exceeded confidence threshold.",
      },
    ],
    cost: { actualUsd: 8.74, estimatedTotalUsd: 22, remainingBudgetUsd: 70.13 },
    lifecycle: {
      currentState: "triggered",
      lastTransitionAt: "2026-03-07T18:34:00.000Z",
      transitions: [
        { state: "active", changedAt: "2026-03-07T17:30:06.000Z", reason: "Monitor initialized." },
        {
          state: "triggered",
          changedAt: "2026-03-07T18:34:00.000Z",
          reason: "8-K compensation signal reached 0.85 confidence.",
        },
      ],
    },
    provenance: {
      source: "monitor_event",
      monitorId: "mtr_81acme",
      eventGroupId: "eg_23040",
      signalStrength: 0.85,
      threshold: 0.7,
      citations: [
        {
          title: "Acme Corp 8-K filing",
          url: "https://www.sec.gov/ixviewer/acme-8k",
          confidence: 0.92,
          excerpt: "Material executive compensation amendment approved by board.",
        },
      ],
    },
    rulesEvaluation: {
      signalStrength: 0.85,
      threshold: 0.7,
      budgetGate: "pass",
      deduplication: "pass",
      rateLimit: "pass",
      depthLimit: "pass",
      scopeCheck: "pass",
      decision: "allowed",
      decisionReason: "Signal strength exceeded threshold and was in scope for active campaign.",
    },
  },
  {
    id: "monitor-acme-news",
    type: "monitor",
    state: "active",
    title: "News Spike Monitor",
    subtitle: "Acme Corp risk news velocity",
    campaignId: CAMPAIGN_ID,
    vendorId: "acme",
    parentId: "campaign-seed",
    childIds: [],
    whyThisNodeExists: "Seeded to detect adverse press clusters linked to supplier risk.",
    whatItIsDoing: "Tracking sources and sentiment delta for emerging governance/legal incidents.",
    spawnedBy: { id: "campaign-seed", type: "campaign", reason: "Initial monitor seeding." },
    spawnedAt: "2026-03-07T17:30:08.000Z",
    spawnedChildren: [],
    cost: { actualUsd: 6.2, estimatedTotalUsd: 18, remainingBudgetUsd: 72.67 },
    lifecycle: {
      currentState: "active",
      lastTransitionAt: "2026-03-07T17:30:08.000Z",
      transitions: [{ state: "active", changedAt: "2026-03-07T17:30:08.000Z", reason: "Monitor initialized." }],
    },
    provenance: { source: "monitor_event", monitorId: "mtr_82acme", citations: [] },
    rulesEvaluation: {
      signalStrength: 0.44,
      threshold: 0.7,
      budgetGate: "pass",
      deduplication: "pass",
      rateLimit: "pass",
      depthLimit: "pass",
      scopeCheck: "pass",
      decision: "queued",
      decisionReason: "Signal under threshold, monitor remains active without spawning.",
    },
  },
  {
    id: "monitor-acme-web",
    type: "monitor",
    state: "active",
    title: "Website + Pricing Monitor",
    subtitle: "Acme Corp pricing and policy diffs",
    campaignId: CAMPAIGN_ID,
    vendorId: "acme",
    parentId: "campaign-seed",
    childIds: [],
    whyThisNodeExists: "Seeded to detect pricing and compliance policy drift.",
    whatItIsDoing: "Watching key pages for changes and classifying materiality.",
    spawnedBy: { id: "campaign-seed", type: "campaign", reason: "Initial monitor seeding." },
    spawnedAt: "2026-03-07T17:30:10.000Z",
    spawnedChildren: [],
    cost: { actualUsd: 4.95, estimatedTotalUsd: 14, remainingBudgetUsd: 73.92 },
    lifecycle: {
      currentState: "active",
      lastTransitionAt: "2026-03-07T17:30:10.000Z",
      transitions: [{ state: "active", changedAt: "2026-03-07T17:30:10.000Z", reason: "Monitor initialized." }],
    },
    provenance: { source: "monitor_event", monitorId: "mtr_83acme", citations: [] },
    rulesEvaluation: {
      signalStrength: 0.33,
      threshold: 0.7,
      budgetGate: "pass",
      deduplication: "pass",
      rateLimit: "pass",
      depthLimit: "pass",
      scopeCheck: "pass",
      decision: "queued",
      decisionReason: "No material drift above threshold yet.",
    },
  },
  {
    id: "monitor-acme-social",
    type: "monitor",
    state: "paused",
    title: "Social Reputation Monitor",
    subtitle: "Acme Corp social sentiment + influence spikes",
    campaignId: CAMPAIGN_ID,
    vendorId: "acme",
    parentId: "campaign-seed",
    childIds: [],
    whyThisNodeExists: "Seeded for fast-moving reputation and community risk signals.",
    whatItIsDoing: "Paused due to temporary rate cap and awaiting next scheduler window.",
    spawnedBy: { id: "campaign-seed", type: "campaign", reason: "Initial monitor seeding." },
    spawnedAt: "2026-03-07T17:30:12.000Z",
    spawnedChildren: [],
    cost: { actualUsd: 2.13, estimatedTotalUsd: 10, remainingBudgetUsd: 76.74 },
    lifecycle: {
      currentState: "paused",
      lastTransitionAt: "2026-03-07T18:12:00.000Z",
      transitions: [
        { state: "active", changedAt: "2026-03-07T17:30:12.000Z", reason: "Monitor initialized." },
        { state: "paused", changedAt: "2026-03-07T18:12:00.000Z", reason: "Rate limiter applied." },
      ],
    },
    provenance: { source: "monitor_event", monitorId: "mtr_84acme", citations: [] },
    rulesEvaluation: {
      signalStrength: 0.28,
      threshold: 0.7,
      budgetGate: "pass",
      deduplication: "pass",
      rateLimit: "blocked",
      depthLimit: "pass",
      scopeCheck: "pass",
      decision: "blocked",
      decisionReason: "Spawn blocked by campaign rate-limit guardrail.",
    },
  },
  {
    id: "research-acme-exec-comp",
    type: "deep_research",
    state: "active",
    title: "Deep Research: Exec Compensation Shift",
    subtitle: "Assess procurement risk from 8-K compensation anomaly",
    campaignId: CAMPAIGN_ID,
    vendorId: "acme",
    parentId: "monitor-acme-sec",
    childIds: [
      "search-acme-board-dispute",
      "search-acme-analyst-reaction",
      "search-acme-litigation",
      "search-acme-subsidiary",
      "search-acme-governance",
      "search-acme-employee-exit",
      "enrich-acme-board",
      "monitor-subsidiary-y",
    ],
    whyThisNodeExists:
      "Spawned by SEC Filing Watch after an executive compensation filing exceeded threshold and required expanded context.",
    whatItIsDoing:
      "Running parallel searches, synthesizing risk evidence, and deciding whether long-term monitoring expansion is justified.",
    spawnedBy: {
      id: "monitor-acme-sec",
      type: "monitor",
      reason: "8-K compensation anomaly scored above threshold.",
    },
    spawnedAt: "2026-03-07T18:34:10.000Z",
    spawnedChildren: [
      { id: "search-acme-board-dispute", type: "search", reason: "Look for board dispute context." },
      { id: "search-acme-analyst-reaction", type: "search", reason: "Collect external analyst response." },
      { id: "search-acme-litigation", type: "search", reason: "Check legal and enforcement spillover." },
      { id: "search-acme-subsidiary", type: "search", reason: "Identify acquisition/subsidiary links." },
      { id: "search-acme-governance", type: "search", reason: "Detect governance structure changes." },
      { id: "search-acme-employee-exit", type: "search", reason: "Assess leadership churn." },
      { id: "enrich-acme-board", type: "enrichment", reason: "Extract structured board member changes." },
      { id: "monitor-subsidiary-y", type: "monitor", reason: "Track newly discovered subsidiary." },
    ],
    cost: { actualUsd: 0.52, estimatedTotalUsd: 0.76, remainingBudgetUsd: 69.61 },
    lifecycle: {
      currentState: "active",
      lastTransitionAt: "2026-03-07T18:35:20.000Z",
      transitions: [
        {
          state: "spawning",
          changedAt: "2026-03-07T18:34:10.000Z",
          reason: "Monitor trigger accepted by rules engine.",
        },
        {
          state: "active",
          changedAt: "2026-03-07T18:35:20.000Z",
          reason: "Search and enrichment children launched.",
        },
      ],
    },
    provenance: {
      source: "deep_research",
      runId: "run_2981",
      taskGroupId: "tg_8921",
      monitorId: "mtr_81acme",
      eventGroupId: "eg_23040",
      signalStrength: 0.85,
      threshold: 0.7,
      citations: [
        {
          title: "Board governance analysis",
          url: "https://example.com/governance-analysis",
          confidence: 0.78,
        },
      ],
    },
    rulesEvaluation: {
      signalStrength: 0.85,
      threshold: 0.7,
      budgetGate: "pass",
      deduplication: "pass",
      rateLimit: "pass",
      depthLimit: "pass",
      scopeCheck: "pass",
      decision: "allowed",
      decisionReason: "All guardrails passed. Deep research spawned.",
    },
  },
  {
    id: "enrich-acme-board",
    type: "enrichment",
    state: "active",
    title: "Board Member Enrichment",
    subtitle: "Extracting structured board-member deltas",
    campaignId: CAMPAIGN_ID,
    vendorId: "acme",
    parentId: "research-acme-exec-comp",
    childIds: [],
    whyThisNodeExists: "Deep research required structured extraction for board dispute context.",
    whatItIsDoing: "Extracting names, roles, timelines, and confidence-ranked supporting citations.",
    spawnedBy: {
      id: "research-acme-exec-comp",
      type: "deep_research",
      reason: "Structured output required for governance risk scoring.",
    },
    spawnedAt: "2026-03-07T18:35:31.000Z",
    spawnedChildren: [],
    cost: { actualUsd: 0.11, estimatedTotalUsd: 0.14, remainingBudgetUsd: 69.5 },
    lifecycle: {
      currentState: "active",
      lastTransitionAt: "2026-03-07T18:35:31.000Z",
      transitions: [{ state: "active", changedAt: "2026-03-07T18:35:31.000Z", reason: "Enrichment launched." }],
    },
    provenance: {
      source: "deep_research",
      runId: "run_2981_enrich",
      taskGroupId: "tg_8921",
      citations: [],
    },
    rulesEvaluation: {
      signalStrength: 0.82,
      threshold: 0.7,
      budgetGate: "pass",
      deduplication: "pass",
      rateLimit: "pass",
      depthLimit: "pass",
      scopeCheck: "pass",
      decision: "allowed",
      decisionReason: "Enrichment is within scope and budget.",
    },
  },
  {
    id: "monitor-subsidiary-y",
    type: "monitor",
    state: "spawning",
    title: "Subsidiary Y Monitor",
    subtitle: "Newly discovered acquired entity watch",
    campaignId: CAMPAIGN_ID,
    vendorId: "subsidiary-y",
    parentId: "research-acme-exec-comp",
    childIds: [],
    whyThisNodeExists:
      "Deep research discovered Subsidiary Y as a newly acquired entity with potential procurement impact.",
    whatItIsDoing: "Provisioning long-term monitor coverage for Subsidiary Y under campaign scope.",
    spawnedBy: {
      id: "research-acme-exec-comp",
      type: "deep_research",
      reason: "Discovered high-relevance entity requiring ongoing monitoring.",
    },
    spawnedAt: "2026-03-07T18:36:04.000Z",
    spawnedChildren: [],
    cost: { actualUsd: 0.03, estimatedTotalUsd: 8.5, remainingBudgetUsd: 69.47 },
    lifecycle: {
      currentState: "spawning",
      lastTransitionAt: "2026-03-07T18:36:04.000Z",
      transitions: [
        {
          state: "spawning",
          changedAt: "2026-03-07T18:36:04.000Z",
          reason: "Provisioning monitor from deep research discovery.",
        },
      ],
    },
    provenance: {
      source: "deep_research",
      runId: "run_2981",
      taskGroupId: "tg_8921",
      citations: [
        {
          title: "Acquisition disclosure",
          url: "https://example.com/acme-subsidiary-y",
          confidence: 0.88,
          excerpt: "Acme completed acquisition of Subsidiary Y last quarter.",
        },
      ],
    },
    rulesEvaluation: {
      signalStrength: 0.88,
      threshold: 0.7,
      budgetGate: "pass",
      deduplication: "pass",
      rateLimit: "pass",
      depthLimit: "pass",
      scopeCheck: "pass",
      decision: "allowed",
      decisionReason: "Entity discovery passed all spawn checks.",
    },
  },
  ...[
    "search-acme-board-dispute",
    "search-acme-analyst-reaction",
    "search-acme-litigation",
    "search-acme-subsidiary",
    "search-acme-governance",
    "search-acme-employee-exit",
  ].map<NodeSeed>((id, index) => ({
    id,
    type: "search" as const,
    state: (index <= 3 ? "complete" : "active") as "complete" | "active",
    title: `Search ${index + 1}`,
    subtitle: `Parallel web search child ${index + 1} for deep research synthesis`,
    campaignId: CAMPAIGN_ID,
    vendorId: "acme",
    parentId: "research-acme-exec-comp",
    childIds: [],
    whyThisNodeExists: "Spawned by deep research decomposition into parallel evidence collection paths.",
    whatItIsDoing: index <= 3 ? "Completed search and submitted evidence to parent synthesis." : "Running targeted web search.",
    spawnedBy: {
      id: "research-acme-exec-comp",
      type: "deep_research" as const,
      reason: "Objective decomposition required parallel evidence streams.",
    },
    spawnedAt: new Date(Date.parse("2026-03-07T18:35:00.000Z") + index * 6_000).toISOString(),
    spawnedChildren: [],
    cost: { actualUsd: 0.02 + index * 0.01, estimatedTotalUsd: 0.06, remainingBudgetUsd: 69.3 - index * 0.02 },
    lifecycle: {
      currentState: index <= 3 ? "complete" : "active",
      lastTransitionAt: new Date(Date.parse("2026-03-07T18:35:00.000Z") + index * 7_000).toISOString(),
      transitions: [
        {
          state: "active",
          changedAt: new Date(Date.parse("2026-03-07T18:35:00.000Z") + index * 6_000).toISOString(),
          reason: "Search spawned.",
        },
        ...(index <= 3
          ? [
              {
                state: "complete" as const,
                changedAt: new Date(Date.parse("2026-03-07T18:35:28.000Z") + index * 6_000).toISOString(),
                reason: "Search completed and attached citations.",
              },
            ]
          : []),
      ],
    },
    provenance: {
      source: "deep_research" as const,
      runId: `run_2981_s${index + 1}`,
      taskGroupId: "tg_8921",
      citations: [],
    },
    rulesEvaluation: {
      signalStrength: 0.8,
      threshold: 0.7,
      budgetGate: "pass" as const,
      deduplication: "pass" as const,
      rateLimit: "pass" as const,
      depthLimit: "pass" as const,
      scopeCheck: "pass" as const,
      decision: "allowed" as const,
      decisionReason: "Child search accepted under active deep research run.",
    },
  })),
];

const edges: ObserveGraphSnapshot["edges"] = [
  { id: "edge-campaign-sec", source: "campaign-seed", target: "monitor-acme-sec", relation: "seeded", reasonSummary: "Seed monitor created", createdAt: "2026-03-07T17:30:06.000Z" },
  { id: "edge-campaign-news", source: "campaign-seed", target: "monitor-acme-news", relation: "seeded", reasonSummary: "Seed monitor created", createdAt: "2026-03-07T17:30:08.000Z" },
  { id: "edge-campaign-web", source: "campaign-seed", target: "monitor-acme-web", relation: "seeded", reasonSummary: "Seed monitor created", createdAt: "2026-03-07T17:30:10.000Z" },
  { id: "edge-campaign-social", source: "campaign-seed", target: "monitor-acme-social", relation: "seeded", reasonSummary: "Seed monitor created", createdAt: "2026-03-07T17:30:12.000Z" },
  {
    id: "edge-sec-research",
    source: "monitor-acme-sec",
    target: "research-acme-exec-comp",
    relation: "investigated",
    reasonSummary: "8-K compensation anomaly triggered deep research",
    createdAt: "2026-03-07T18:34:10.000Z",
    confidence: 0.85,
  },
  ...[
    "search-acme-board-dispute",
    "search-acme-analyst-reaction",
    "search-acme-litigation",
    "search-acme-subsidiary",
    "search-acme-governance",
    "search-acme-employee-exit",
  ].map((id, index) => ({
    id: `edge-research-${index}`,
    source: "research-acme-exec-comp",
    target: id,
    relation: "spawned" as const,
    reasonSummary: `Parallel search child ${index + 1} launched`,
    createdAt: new Date(Date.parse("2026-03-07T18:35:00.000Z") + index * 6_000).toISOString(),
    confidence: 0.82,
  })),
  {
    id: "edge-research-enrich",
    source: "research-acme-exec-comp",
    target: "enrich-acme-board",
    relation: "enriched",
    reasonSummary: "Structured board extraction requested",
    createdAt: "2026-03-07T18:35:31.000Z",
    confidence: 0.82,
  },
  {
    id: "edge-research-monitor-y",
    source: "research-acme-exec-comp",
    target: "monitor-subsidiary-y",
    relation: "discovered",
    reasonSummary: "Subsidiary Y discovered and escalated to long-term monitoring",
    createdAt: "2026-03-07T18:36:04.000Z",
    confidence: 0.88,
  },
];

const timeline = [
  {
    id: "evt-1",
    happenedAt: "2026-03-07T17:30:00.000Z",
    nodeId: "campaign-seed",
    nodeType: "campaign",
    state: "active",
    summary: "Campaign launched and initial monitor topology seeded.",
  },
  {
    id: "evt-2",
    happenedAt: "2026-03-07T18:34:00.000Z",
    nodeId: "monitor-acme-sec",
    nodeType: "monitor",
    state: "triggered",
    summary: "SEC monitor fired on anomalous 8-K compensation filing (0.85 confidence).",
  },
  {
    id: "evt-3",
    happenedAt: "2026-03-07T18:34:10.000Z",
    nodeId: "research-acme-exec-comp",
    nodeType: "deep_research",
    state: "spawning",
    summary: "Deep research spawned from monitor trigger with risk-impact objective.",
  },
  {
    id: "evt-4",
    happenedAt: "2026-03-07T18:35:31.000Z",
    nodeId: "enrich-acme-board",
    nodeType: "enrichment",
    state: "active",
    summary: "Board-member enrichment task launched for structured governance extraction.",
  },
  {
    id: "evt-5",
    happenedAt: "2026-03-07T18:36:04.000Z",
    nodeId: "monitor-subsidiary-y",
    nodeType: "monitor",
    state: "spawning",
    summary: "New monitor created for discovered Subsidiary Y entity.",
  },
] as ObserveGraphSnapshot["timeline"];

export const observeMockSnapshot: ObserveGraphSnapshot = {
  campaignId: CAMPAIGN_ID,
  campaignName: "Q1 Procurement Autonomous Risk Intelligence",
  generatedAt: "2026-03-07T18:36:10.000Z",
  budget: {
    totalUsd: 120,
    spentUsd: 50.53,
    remainingUsd: 69.47,
  },
  nodes,
  edges,
  timeline,
  transportPhases: [
    {
      id: "snapshot",
      title: "Snapshot Mode",
      status: "available",
      details: "Static graph from latest orchestration checkpoint. Deterministic and safe for demos.",
    },
    {
      id: "replay",
      title: "Replay Mode",
      status: "partial",
      details: "Chronological event playback from audit lineage with deterministic graph reconstruction.",
    },
    {
      id: "live",
      title: "Live Mode",
      status: "planned",
      details: "Realtime stream over WebSocket/SSE with reconnection and event catchup semantics.",
    },
  ],
};

export const observeNodeTypeLabels = Object.freeze({
  campaign: typeLabel("campaign"),
  monitor: typeLabel("monitor"),
  search: typeLabel("search"),
  deep_research: typeLabel("deep_research"),
  enrichment: typeLabel("enrichment"),
  find_all: typeLabel("find_all"),
  cluster: typeLabel("cluster"),
});
