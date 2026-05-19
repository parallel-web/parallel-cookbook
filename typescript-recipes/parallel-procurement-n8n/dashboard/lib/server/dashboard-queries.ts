import "server-only";
import { db } from "./db";
import type {
  ActionQueueItem,
  AdverseEvent as DashboardAdverseEvent,
  DashboardData,
  EvidenceItem,
  FeedItem,
  MetricCard,
  MonitorLens,
  RiskDimension,
  RiskLevel,
  VendorProfile,
} from "@/lib/types/dashboard";
import type { VendorRow } from "./vendors";

interface AssessmentRow {
  id: string;
  vendor_id: string;
  status: "pending" | "running" | "completed" | "failed";
  risk_level: RiskLevel | null;
  score: number | null;
  movement: number | null;
  recommendation: string | null;
  adverse_flag: boolean | null;
  action_required: boolean | null;
  dimensions: RiskDimension[] | null;
  adverse_events:
    | Array<{
        title: string;
        date: string;
        category: string;
        severity: RiskLevel;
        source_url?: string;
        description: string;
      }>
    | null;
  triggered_overrides: string[] | null;
  summary: string | null;
  assessment_date: string;
  created_at: string;
  raw_output: unknown;
}

interface MonitorRow {
  id: string;
  vendor_id: string;
  dimension: string;
  monitor_category: string | null;
  cadence: string;
  query: string;
  status: "active" | "watching" | "needs_review" | "canceled" | "failed";
  last_event_at: string | null;
}

interface MonitorEventRow {
  id: string;
  vendor_id: string;
  severity: RiskLevel | null;
  dimension: string | null;
  title: string;
  detail: string | null;
  source_url: string | null;
  received_at: string;
  parallel_event_id: string | null;
}

const DIMENSION_LABELS: Record<string, string> = {
  financial_health: "Financial health",
  legal_regulatory: "Legal & regulatory",
  cybersecurity: "Cybersecurity",
  leadership_governance: "Leadership & governance",
  esg_reputation: "ESG & reputation",
};

const RISK_RANK: Record<RiskLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function emptyDimensions(): RiskDimension[] {
  return [
    { key: "financial_health", label: "Financial health", severity: "LOW", status: "pending", findings: "No research yet." },
    { key: "legal_regulatory", label: "Legal & regulatory", severity: "LOW", status: "pending", findings: "No research yet." },
    { key: "cybersecurity", label: "Cybersecurity", severity: "LOW", status: "pending", findings: "No research yet." },
    { key: "leadership_governance", label: "Leadership & governance", severity: "LOW", status: "pending", findings: "No research yet." },
    { key: "esg_reputation", label: "ESG & reputation", severity: "LOW", status: "pending", findings: "No research yet." },
  ];
}

function rowsByVendor<T extends { vendor_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const arr = m.get(r.vendor_id);
    if (arr) arr.push(r);
    else m.set(r.vendor_id, [r]);
  }
  return m;
}

function buildVendorProfile(args: {
  vendor: VendorRow;
  latestAssessment: AssessmentRow | null;
  monitors: MonitorRow[];
}): VendorProfile {
  const { vendor, latestAssessment, monitors } = args;

  const isCompleted = latestAssessment?.status === "completed";

  const riskLevel: RiskLevel = (isCompleted && latestAssessment?.risk_level) || "LOW";
  const score = isCompleted ? latestAssessment?.score ?? 0 : 0;
  const movementValue = latestAssessment?.movement ?? 0;
  const movementText = isCompleted
    ? movementValue === 0
      ? "+0 stable"
      : `${movementValue > 0 ? "+" : ""}${movementValue} risk score change`
    : latestAssessment?.status === "running" || latestAssessment?.status === "pending"
      ? "researching…"
      : "+0 awaiting research";

  const dimensions =
    isCompleted && latestAssessment?.dimensions?.length
      ? latestAssessment.dimensions.map((d) => ({
          ...d,
          label: DIMENSION_LABELS[d.key] ?? d.label,
        }))
      : emptyDimensions();

  const adverseEvents: DashboardAdverseEvent[] = (latestAssessment?.adverse_events ?? []).map((e) => ({
    title: e.title,
    date: e.date,
    category: e.category,
    severity: e.severity,
    description: e.description,
    sourceUrl: e.source_url ?? "",
  }));

  // Evidence list reuses adverse events as the primary "evidence" entries —
  // the existing UI shows both side by side. We don't synthesize fake URLs.
  const evidence: EvidenceItem[] = adverseEvents.map((e) => ({
    title: e.title,
    publication: e.category,
    publishedAt: e.date,
    materiality: e.description,
    href: e.sourceUrl || "#",
  }));

  const monitorLenses: MonitorLens[] = monitors.map((m) => ({
    dimension: DIMENSION_LABELS[`${m.dimension}_dimension`] ?? labelForMonitorDimension(m.dimension),
    cadence: m.cadence === "daily" ? "Daily" : m.cadence === "weekly" ? "Weekly" : m.cadence,
    status:
      m.status === "active" || m.status === "watching" || m.status === "needs_review"
        ? m.status
        : "watching",
    query: m.query,
    lastEvent: m.last_event_at ? formatRelativeTime(m.last_event_at) : "—",
  }));

  return {
    id: vendor.id,
    vendorName: vendor.vendor_name,
    vendorDomain: vendor.vendor_domain.startsWith("http")
      ? vendor.vendor_domain
      : `https://${vendor.vendor_domain}`,
    vendorCategory: vendor.vendor_category,
    monitoringPriority: vendor.monitoring_priority,
    relationshipOwner: vendor.relationship_owner ?? "Unassigned",
    region: vendor.region ?? "—",
    riskLevel,
    overallRiskLevel: riskLevel,
    score,
    actionRequired: !!latestAssessment?.action_required,
    adverseFlag: !!latestAssessment?.adverse_flag,
    recommendation: latestAssessment?.recommendation ?? (isCompleted ? "continue_monitoring" : "awaiting_research"),
    summary:
      latestAssessment?.summary ??
      (isCompleted
        ? `${vendor.vendor_name} has no completed analysis yet.`
        : `${vendor.vendor_name} is awaiting its first research run.`),
    movement: movementText,
    lastAssessmentDate: isCompleted
      ? latestAssessment.assessment_date
      : latestAssessment?.created_at?.slice(0, 10) ?? vendor.created_at.slice(0, 10),
    nextResearchDate: vendor.next_research_date ?? new Date().toISOString().slice(0, 10),
    triggeredOverrides: latestAssessment?.triggered_overrides ?? [],
    dimensions,
    adverseEvents,
    evidence,
    monitors: monitorLenses,
    pending: !isCompleted,
  };
}

function labelForMonitorDimension(dim: string): string {
  const map: Record<string, string> = {
    legal: "Legal & regulatory",
    cyber: "Cybersecurity",
    financial: "Financial health",
    leadership: "Leadership & governance",
    esg: "ESG & reputation",
  };
  return map[dim] ?? dim;
}

function formatRelativeTime(timestamp: string): string {
  const t = new Date(timestamp).getTime();
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function severityToTone(level: RiskLevel | undefined): MetricCard["tone"] {
  if (level === "CRITICAL") return "critical";
  if (level === "HIGH") return "warning";
  if (level === "LOW") return "positive";
  return "default";
}

function buildMetrics(args: {
  vendors: VendorRow[];
  vendorProfiles: VendorProfile[];
  monitorRows: MonitorRow[];
  feedItems: FeedItem[];
  pendingAssessments: number;
  failedAssessments: number;
  todayResearched: number;
  todayDue: number;
}): MetricCard[] {
  const { vendorProfiles, monitorRows, pendingAssessments, todayDue } = args;

  const counts = vendorProfiles.reduce(
    (acc, v) => {
      acc[v.riskLevel] = (acc[v.riskLevel] ?? 0) + 1;
      return acc;
    },
    { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } as Record<RiskLevel, number>,
  );

  const actionCount = vendorProfiles.filter((v) => v.actionRequired).length;
  const completedCount = vendorProfiles.filter((v) => !v.pending).length;

  const portfolioPosture: MetricCard = {
    label: "Portfolio risk posture",
    value:
      counts.CRITICAL || counts.HIGH
        ? `${counts.CRITICAL} CRITICAL / ${counts.HIGH} HIGH`
        : completedCount === 0
          ? "Awaiting research"
          : `${counts.MEDIUM} MEDIUM / ${counts.LOW} LOW`,
    trend:
      vendorProfiles.length === 0
        ? "Add vendors to begin"
        : `${actionCount} of ${vendorProfiles.length} require attention`,
    tone: severityToTone(counts.CRITICAL ? "CRITICAL" : counts.HIGH ? "HIGH" : "LOW"),
  };

  const cadence: MetricCard = {
    label: "Research cadence",
    value:
      pendingAssessments > 0
        ? `${pendingAssessments} researching`
        : todayDue > 0
          ? `${todayDue} due today`
          : `${completedCount} up to date`,
    trend: `${completedCount} of ${vendorProfiles.length || 0} vendors have a current assessment`,
    tone: pendingAssessments > 0 ? "warning" : "positive",
  };

  const fleetHealth: MetricCard = {
    label: "Monitor fleet health",
    value: monitorRows.length === 0 ? "0 active" : `${monitorRows.length} active`,
    trend:
      monitorRows.length === 0
        ? "Deploy monitors from Portfolio"
        : "Webhook delivery healthy",
    tone: monitorRows.length === 0 ? "default" : "positive",
  };

  const queue: MetricCard = {
    label: "Action queue",
    value: actionCount === 0 ? "No escalations" : `${actionCount} escalations`,
    trend:
      actionCount === 0
        ? "All vendors stable"
        : `${actionCount} require ownership before next cycle`,
    tone: actionCount > 0 ? "default" : "positive",
  };

  return [portfolioPosture, cadence, fleetHealth, queue];
}

export interface DashboardSnapshot extends DashboardData {
  hasVendors: boolean;
  pendingAssessments: number;
}

export async function getDashboardSnapshot(accountId: string): Promise<DashboardSnapshot> {
  const supabase = db();

  const [vendorsRes, assessmentsRes, monitorsRes, monitorEventsRes] = await Promise.all([
    supabase
      .from("vendors")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true }),
    supabase
      .from("risk_assessments")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false }),
    supabase
      .from("monitors")
      .select("*")
      .eq("account_id", accountId),
    supabase
      .from("monitor_events")
      .select("*")
      .eq("account_id", accountId)
      .order("received_at", { ascending: false })
      .limit(50),
  ]);

  if (vendorsRes.error) throw vendorsRes.error;
  if (assessmentsRes.error) throw assessmentsRes.error;
  if (monitorsRes.error) throw monitorsRes.error;
  if (monitorEventsRes.error) throw monitorEventsRes.error;

  const vendors = (vendorsRes.data ?? []) as VendorRow[];
  const allAssessments = (assessmentsRes.data ?? []) as AssessmentRow[];
  const monitors = (monitorsRes.data ?? []) as MonitorRow[];
  const events = (monitorEventsRes.data ?? []) as MonitorEventRow[];

  // Pick the latest assessment per vendor (rows already ordered desc).
  const latestAssessment = new Map<string, AssessmentRow>();
  const latestCompletedAssessment = new Map<string, AssessmentRow>();
  for (const a of allAssessments) {
    if (!latestAssessment.has(a.vendor_id)) latestAssessment.set(a.vendor_id, a);
    if (a.status === "completed" && !latestCompletedAssessment.has(a.vendor_id)) {
      latestCompletedAssessment.set(a.vendor_id, a);
    }
  }

  const monitorsByVendor = rowsByVendor(monitors);

  const vendorProfiles: VendorProfile[] = vendors.map((vendor) => {
    const completed = latestCompletedAssessment.get(vendor.id) ?? null;
    const latest = latestAssessment.get(vendor.id) ?? null;
    const profile = buildVendorProfile({
      vendor,
      latestAssessment: completed ?? latest,
      monitors: monitorsByVendor.get(vendor.id) ?? [],
    });
    if (!completed && latest && (latest.status === "running" || latest.status === "pending")) {
      profile.pending = true;
      profile.movement = "researching…";
    }
    return profile;
  });

  // Sort vendors by score desc so the top of the dashboard shows the
  // riskiest profile first.
  vendorProfiles.sort((a, b) => {
    const rankDiff = RISK_RANK[b.riskLevel] - RISK_RANK[a.riskLevel];
    if (rankDiff !== 0) return rankDiff;
    return b.score - a.score;
  });

  const vendorById = new Map<string, VendorProfile>();
  for (const p of vendorProfiles) vendorById.set(p.id, p);

  // Action queue = vendors flagged action_required, sorted by severity.
  const actionQueue: ActionQueueItem[] = vendorProfiles
    .filter((v) => v.actionRequired)
    .map((v) => ({
      vendorName: v.vendorName,
      vendorId: v.id,
      owner: v.relationshipOwner,
      deadline: actionDeadlineFor(v.riskLevel),
      action: actionStringFor(v),
      riskLevel: v.riskLevel,
    }));

  // Feed = monitor events.
  const feed: FeedItem[] = events.map((e) => {
    const vendor = vendors.find((v) => v.id === e.vendor_id);
    return {
      vendorName: vendor?.vendor_name ?? "Unknown vendor",
      vendorId: vendor?.id,
      title: e.title,
      severity: e.severity ?? "LOW",
      timestamp: formatRelativeTime(e.received_at),
      detail: e.detail ?? "",
      sourceUrl: e.source_url ?? "",
    };
  });

  const pendingAssessments = allAssessments.filter(
    (a) => a.status === "pending" || a.status === "running",
  ).length;
  const failedAssessments = allAssessments.filter((a) => a.status === "failed").length;
  const todayResearched = allAssessments.filter(
    (a) =>
      a.status === "completed" &&
      a.assessment_date === new Date().toISOString().slice(0, 10),
  ).length;
  const today = new Date().toISOString().slice(0, 10);
  const todayDue = vendors.filter(
    (v) => v.next_research_date && v.next_research_date <= today,
  ).length;

  const metrics = buildMetrics({
    vendors,
    vendorProfiles,
    monitorRows: monitors,
    feedItems: feed,
    pendingAssessments,
    failedAssessments,
    todayResearched,
    todayDue,
  });

  const riskDistribution: DashboardData["riskDistribution"] = (
    ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as RiskLevel[]
  ).map((label) => ({
    label,
    count: vendorProfiles.filter((v) => v.riskLevel === label).length,
  }));

  const lastUpdated =
    allAssessments[0]?.created_at ?? events[0]?.received_at ?? new Date().toISOString();

  return {
    hasVendors: vendors.length > 0,
    pendingAssessments,
    lastUpdated,
    metrics,
    riskDistribution,
    researchSummary: {
      totalDue: todayDue,
      totalResearched: todayResearched,
      totalFailed: failedAssessments,
      adverseCount: vendorProfiles.filter((v) => v.adverseFlag).length,
      batchesExecuted: new Set(allAssessments.map((a) => a.id)).size > 0 ? 1 : 0,
      duration: pendingAssessments > 0 ? "in progress" : "—",
    },
    health: {
      totalMonitors: monitors.length,
      activeCount: monitors.filter((m) => m.status === "active").length,
      failedCount: monitors.filter((m) => m.status === "failed").length,
      orphanCount: 0,
      recreated: 0,
      webhookHealthy: monitors.length === 0 ? true : monitors.some((m) => m.last_event_at !== null),
    },
    feed,
    actionQueue,
    vendors: vendorProfiles,
  };
}

function actionDeadlineFor(level: RiskLevel): string {
  if (level === "CRITICAL") return "Due in 24h";
  if (level === "HIGH") return "Due in 48h";
  if (level === "MEDIUM") return "Due in 7d";
  return "—";
}

function actionStringFor(vendor: VendorProfile): string {
  if (vendor.recommendation === "suspend_relationship") {
    return "Validate breach scope, suspend purchases, and notify legal.";
  }
  if (vendor.recommendation === "initiate_contingency") {
    return "Update concentration risk memo and confirm backup supplier readiness.";
  }
  if (vendor.recommendation === "escalate_review") {
    return "Schedule review with vendor owner and pull latest evidence.";
  }
  return "Continue monitoring; no action required this cycle.";
}

export async function getVendorById(
  accountId: string,
  vendorId: string,
): Promise<VendorProfile | null> {
  const snapshot = await getDashboardSnapshot(accountId);
  return snapshot.vendors.find((v) => v.id === vendorId) ?? null;
}
