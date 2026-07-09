// Backwards-compatible re-export of dashboard types.
// The hardcoded `dashboardData` constant has been replaced by per-account
// queries in lib/server/dashboard-queries.ts.

export {
  dimensionOrder,
  dimensionLabels,
} from "./types/dashboard";

export type {
  ActionQueueItem,
  AdverseEvent,
  DashboardData,
  DimensionKey,
  EvidenceItem,
  FeedItem,
  MetricCard,
  MonitorLens,
  MonitoringPriority,
  RiskDimension,
  RiskLevel,
  VendorProfile,
} from "./types/dashboard";
