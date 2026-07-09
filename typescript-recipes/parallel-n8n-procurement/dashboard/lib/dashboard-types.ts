export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type MonitoringPriority = "high" | "medium" | "low";
export type DimensionKey =
  | "financial_health"
  | "legal_regulatory"
  | "cybersecurity"
  | "leadership_governance"
  | "esg_reputation";

export interface MetricCard {
  label: string;
  value: string;
  trend: string;
  tone: "default" | "critical" | "warning" | "positive";
}

export interface RiskDimension {
  key: DimensionKey;
  label: string;
  severity: RiskLevel;
  status: string;
  findings: string;
}

export interface AdverseEvent {
  title: string;
  date: string;
  category: string;
  severity: RiskLevel;
  description: string;
  sourceUrl: string;
}

export interface EvidenceItem {
  title: string;
  publication: string;
  publishedAt: string;
  materiality: string;
  href: string;
}

export interface MonitorLens {
  dimension: string;
  cadence: string;
  status: "active" | "watching" | "needs_review";
  query: string;
  lastEvent: string;
}

export interface VendorProfile {
  id: string;
  vendorName: string;
  vendorDomain: string;
  vendorCategory: string;
  monitoringPriority: MonitoringPriority;
  relationshipOwner: string;
  region: string;
  riskLevel: RiskLevel;
  overallRiskLevel: RiskLevel;
  score: number;
  actionRequired: boolean;
  adverseFlag: boolean;
  recommendation: string;
  summary: string;
  movement: string;
  lastAssessmentDate: string;
  nextResearchDate: string;
  triggeredOverrides: string[];
  dimensions: RiskDimension[];
  adverseEvents: AdverseEvent[];
  evidence: EvidenceItem[];
  monitors: MonitorLens[];
}

export interface DashboardData {
  lastUpdated: string;
  metrics: MetricCard[];
  riskDistribution: Array<{ label: RiskLevel; count: number }>;
  researchSummary: {
    totalDue: number;
    totalResearched: number;
    totalFailed: number;
    adverseCount: number;
    batchesExecuted: number;
    duration: string;
  };
  health: {
    totalMonitors: number;
    activeCount: number;
    failedCount: number;
    orphanCount: number;
    recreated: number;
    webhookHealthy: boolean;
  };
  feed: Array<{
    vendorName: string;
    title: string;
    severity: RiskLevel;
    timestamp: string;
    detail: string;
    sourceUrl: string;
  }>;
  actionQueue: Array<{
    vendorName: string;
    owner: string;
    deadline: string;
    action: string;
    riskLevel: RiskLevel;
  }>;
  vendors: VendorProfile[];
}

export const dimensionOrder: DimensionKey[] = [
  "financial_health",
  "legal_regulatory",
  "cybersecurity",
  "leadership_governance",
  "esg_reputation",
];
