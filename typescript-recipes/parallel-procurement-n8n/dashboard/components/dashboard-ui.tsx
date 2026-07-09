import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Globe, MoveUpRight } from "lucide-react";
import {
  dimensionOrder,
  type ActionQueueItem,
  type DashboardData,
  type FeedItem,
  type RiskLevel,
  type VendorProfile,
} from "@/lib/types/dashboard";
import { AccountMenu } from "@/components/AccountMenu";

type SectionId = "overview" | "attention" | "portfolio" | "feed" | "observe";

const navigation: Array<{ id: SectionId; label: string; href: string }> = [
  { id: "overview", label: "Overview", href: "/" },
  { id: "attention", label: "Attention", href: "/attention" },
  { id: "portfolio", label: "Portfolio", href: "/portfolio" },
  { id: "feed", label: "Feed", href: "/feed" },
  { id: "observe", label: "Observe", href: "/observe" },
];

const severityOrder: Record<RiskLevel, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(input: string | undefined | null) {
  if (!input) return "—";
  try {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
      new Date(input),
    );
  } catch {
    return input;
  }
}

export function formatUpdatedTime(input: string | undefined | null) {
  if (!input) return "—";
  try {
    return new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    }).format(new Date(input));
  } catch {
    return "—";
  }
}

export function riskClass(level: RiskLevel) {
  return level.toLowerCase();
}

export function movementValue(movement: string) {
  return movement.match(/[+-]\d+/)?.[0] ?? movement;
}

export function priorityLabel(priority: VendorProfile["monitoringPriority"]) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function recommendationLabel(recommendation: string) {
  return recommendation.replaceAll("_", " ");
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toUpperCase();
}

function shapeForRisk(level: RiskLevel) {
  if (level === "LOW") return "●";
  if (level === "MEDIUM") return "▲";
  if (level === "HIGH") return "■";
  return "◆";
}

function topDrivers(vendor: VendorProfile) {
  return [...vendor.dimensions]
    .sort((left, right) => severityOrder[right.severity] - severityOrder[left.severity])
    .slice(0, 2);
}

function driverLabel(label: string) {
  const labels: Record<string, string> = {
    "Financial health": "Financial",
    "Legal & regulatory": "Legal",
    Cybersecurity: "Cyber",
    "Leadership & governance": "Governance",
    "ESG & reputation": "ESG",
  };
  return labels[label] ?? label;
}

// ── Shell ─────────────────────────────────────────────────────────────────

export interface DashboardShellProps {
  section: SectionId;
  title: string;
  subtitle: string;
  children: ReactNode;
  aside?: ReactNode;
  breadcrumb?: ReactNode;
  headerMeta?: ReactNode;
  lastUpdated?: string;
  account: { displayName: string | null; email: string | null };
}

export function DashboardShell({
  section,
  title,
  subtitle,
  children,
  aside,
  breadcrumb,
  headerMeta,
  lastUpdated,
  account,
}: DashboardShellProps) {
  return (
    <div className="dashboard-shell app-shell">
      <header className="app-header">
        <div className="app-header-bar">
          <Link href="/" className="app-brand">
            Parallel Procurement
          </Link>
          <nav className="app-nav" aria-label="Primary">
            {navigation.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={cn("app-nav-link", item.id === section && "active")}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="app-header-account">
            <AccountMenu displayName={account.displayName} email={account.email} />
          </div>
        </div>

        <div className={cn("page-header", aside ? "has-aside" : undefined)}>
          <div className="page-header-copy">
            {breadcrumb ? <div className="page-breadcrumb">{breadcrumb}</div> : null}
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
            {headerMeta ? (
              headerMeta
            ) : (
              <div className="page-meta">
                <span>Updated {formatUpdatedTime(lastUpdated)} UTC</span>
              </div>
            )}
          </div>
          {aside ? <div className="page-header-aside">{aside}</div> : null}
        </div>
      </header>

      <main className="page-content">{children}</main>
    </div>
  );
}

// ── Empty state helpers ──────────────────────────────────────────────────

export function EmptyState({
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  description: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <section className="surface-panel empty-state-panel">
      <div className="empty-state">
        <strong>{title}</strong>
        <p>{description}</p>
        {ctaHref && ctaLabel ? (
          <Link href={ctaHref} className="text-link">
            {ctaLabel} <ArrowRight size={14} />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

// ── Panels (data flows in via props) ─────────────────────────────────────

export function ActionCard({ data }: { data: DashboardData }) {
  const firstCriticalVendor = data.vendors.find((v) => v.riskLevel === "CRITICAL") ?? data.vendors[0];
  const actionRequiredCount = data.vendors.filter((v) => v.actionRequired).length;
  if (!firstCriticalVendor) return null;
  return (
    <Link href={`/vendors/${firstCriticalVendor.id}`} className="action-card">
      <span className="meta-label">Action required</span>
      <strong>
        {actionRequiredCount} {actionRequiredCount === 1 ? "vendor needs" : "vendors need"} attention
      </strong>
      <span className="action-card-button">Open highest-priority vendor</span>
    </Link>
  );
}

export function MetricsBand({ data }: { data: DashboardData }) {
  return (
    <section className="summary-band">
      <div className="summary-metrics">
        {data.metrics.map((metric) => (
          <div key={metric.label} className="metric-card">
            <span className="metric-card-label">{metric.label}</span>
            {metric.value.includes("/") ? (
              <strong className="metric-card-value stacked">
                {metric.value.split(" / ").map((part) => (
                  <span key={part}>{part}</span>
                ))}
              </strong>
            ) : (
              <strong className="metric-card-value">{metric.value}</strong>
            )}
            <p className="metric-card-trend">{metric.trend}</p>
          </div>
        ))}
      </div>
      <div className="summary-note">
        <span className="eyebrow">Today</span>
        <p>
          {data.researchSummary.totalDue} vendors are due for review.{" "}
          {data.researchSummary.totalFailed} stayed queued after failed runs, and{" "}
          {data.researchSummary.adverseCount} show adverse conditions.
        </p>
      </div>
    </section>
  );
}

export function ImmediateAttentionPreview({ data }: { data: DashboardData }) {
  const actionQueue = data.actionQueue;
  if (actionQueue.length === 0) {
    return (
      <EmptyState
        title="No vendors need immediate attention"
        description="When a vendor's risk score crosses HIGH or CRITICAL, it will appear here with its review deadline."
      />
    );
  }
  return (
    <section className="surface-panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Priority notes ({actionQueue.length})</div>
        </div>
        <Link href="/attention" className="text-link">
          Review all <ArrowRight size={14} />
        </Link>
      </div>

      <div className="priority-list">
        {actionQueue.slice(0, 3).map((item) => (
          <Link
            key={`${item.vendorName}-${item.deadline}`}
            href={`/vendors/${item.vendorId ?? ""}`}
            className="priority-item"
          >
            <div className="priority-item-top">
              <strong>{item.vendorName}</strong>
              <div className="priority-item-meta">
                <span className="priority-deadline">{item.deadline}</span>
                <RiskSignal level={item.riskLevel} />
              </div>
            </div>
            <p>{item.action}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function AttentionQueuePage({ data }: { data: DashboardData }) {
  if (data.actionQueue.length === 0) {
    return (
      <EmptyState
        title="No active escalations"
        description="When a vendor crosses your HIGH or CRITICAL threshold, it will be queued here for review."
      />
    );
  }
  return (
    <section className="surface-panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Queue</div>
        </div>
      </div>

      <div className="attention-table">
        <div className="attention-head">
          <span>Vendor</span>
          <span>Owner</span>
          <span>Deadline</span>
          <span>Risk</span>
          <span>Action</span>
        </div>

        {data.actionQueue.map((item: ActionQueueItem) => (
          <Link
            key={`${item.vendorName}-${item.deadline}`}
            href={`/vendors/${item.vendorId ?? ""}`}
            className="attention-row"
          >
            <span className="attention-vendor">
              <strong>{item.vendorName}</strong>
              <small>{item.owner}</small>
            </span>
            <span>{item.owner}</span>
            <span>{item.deadline}</span>
            <span>
              <RiskSignal level={item.riskLevel} />
            </span>
            <span>{item.action}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function WatchlistTable({ data, limit }: { data: DashboardData; limit?: number }) {
  if (data.vendors.length === 0) {
    return (
      <EmptyState
        title="No vendors yet"
        description="Add vendors to start the continuous risk monitoring loop."
        ctaHref="/onboarding/vendors"
        ctaLabel="Add vendors"
      />
    );
  }

  const vendors = limit ? data.vendors.slice(0, limit) : data.vendors;

  return (
    <section className="surface-panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Portfolio</div>
        </div>
        <Link href="/portfolio" className="text-link">
          Open risk matrix <ArrowRight size={14} />
        </Link>
      </div>

      <div className="watchlist-table">
        <div className="watchlist-head">
          <span>Vendor</span>
          <span>Owner</span>
          <span>Level</span>
          <span>Key drivers</span>
          <span>Score</span>
          <span>Next</span>
          <span>Movement</span>
        </div>

        {vendors.map((vendor) => (
          <Link
            key={vendor.id}
            href={`/vendors/${vendor.id}`}
            className={cn("watchlist-row", vendor.riskLevel === "CRITICAL" && "critical-row")}
          >
            <span className="roster-vendor">
              <strong>{vendor.vendorName}</strong>
              <small>{vendor.vendorCategory.replaceAll("_", " ")}</small>
            </span>
            <span>{vendor.relationshipOwner}</span>
            <span>
              <RiskSignal level={vendor.riskLevel} />
            </span>
            <span className="driver-stack">
              {topDrivers(vendor).map((dimension) => (
                <SeverityTag
                  key={`${vendor.id}-${dimension.key}`}
                  level={dimension.severity}
                  label={driverLabel(dimension.label)}
                />
              ))}
            </span>
            <span className="score-cell">
              <strong>{vendor.pending ? "—" : vendor.score}</strong>
            </span>
            <span>{formatDate(vendor.nextResearchDate)}</span>
            <span
              className={cn(
                "movement-cell",
                vendor.movement.trim().startsWith("-") ? "down" : "up",
              )}
            >
              <strong>{movementValue(vendor.movement)}</strong>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function RiskMatrixPanel({ data }: { data: DashboardData }) {
  if (data.vendors.length === 0) return null;
  return (
    <section className="surface-panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Portfolio map</div>
          <h2>Risk coverage matrix</h2>
        </div>
        <div className="distribution-list">
          {data.riskDistribution.map((band) => (
            <div key={band.label} className="distribution-item">
              <RiskBadge level={band.label} />
              <strong>{band.count}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="matrix-table">
        <div className="matrix-head row">
          <span>Vendor</span>
          {dimensionOrder.map((dimension) => (
            <span key={dimension}>{dimension.replaceAll("_", " ")}</span>
          ))}
          <span>Level</span>
        </div>

        {data.vendors.map((vendor) => (
          <Link
            key={vendor.id}
            href={`/vendors/${vendor.id}`}
            className={cn("matrix-row", vendor.riskLevel === "CRITICAL" && "critical-row")}
          >
            <div className="matrix-vendor">
              <span className="matrix-vendor-name">{vendor.vendorName}</span>
              <span className="matrix-vendor-owner">{vendor.relationshipOwner}</span>
            </div>
            {dimensionOrder.map((dimension) => {
              const value = vendor.dimensions.find((item) => item.key === dimension);
              return value ? <SeverityCell key={dimension} level={value.severity} /> : null;
            })}
            <div className="matrix-action">
              <SeverityCell level={vendor.riskLevel} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function OperationsPanel({ data }: { data: DashboardData }) {
  return (
    <section className="surface-panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Operations</div>
        </div>
      </div>

      <div className="ops-summary">
        <div className="ops-line">
          <span>Fleet health</span>
          <strong>
            {data.health.activeCount}/{data.health.totalMonitors}
          </strong>
        </div>
        <div className="ops-line">
          <span>Failed monitors</span>
          <strong>{data.health.failedCount}</strong>
        </div>
        <div className="ops-line">
          <span>Orphans</span>
          <strong>{data.health.orphanCount}</strong>
        </div>
        <div className="ops-line">
          <span>Run duration</span>
          <strong>{data.researchSummary.duration}</strong>
        </div>
      </div>
    </section>
  );
}

export function FeedPanel({
  data,
  expanded = false,
  streamOnly = false,
}: {
  data: DashboardData;
  expanded?: boolean;
  streamOnly?: boolean;
}) {
  if (data.feed.length === 0) {
    return (
      <EmptyState
        title="No monitor events yet"
        description="Once you deploy monitors for your vendors, real-time risk events will appear here."
      />
    );
  }

  const items = expanded ? data.feed : data.feed.slice(0, 4);

  return (
    <section className={cn(streamOnly ? "feed-stream-page" : "surface-panel")}>
      {!streamOnly ? (
        <div className="section-heading">
          <div>
            <div className="eyebrow">Feed</div>
          </div>
        </div>
      ) : null}

      <div className={cn("feed-list", streamOnly && "stream-only")}>
        {items.map((item: FeedItem) => (
          <FeedRow key={`${item.vendorName}-${item.title}-${item.timestamp}`} item={item} />
        ))}
      </div>
    </section>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  if (item.sourceUrl) {
    return (
      <a className="feed-item" href={item.sourceUrl} target="_blank" rel="noreferrer">
        <FeedRowBody item={item} />
      </a>
    );
  }
  return (
    <div className="feed-item">
      <FeedRowBody item={item} />
    </div>
  );
}

function FeedRowBody({ item }: { item: FeedItem }) {
  return (
    <>
      <div className="feed-log-line">
        <span className="feed-log-time">[{item.timestamp}]</span>
        <strong>{item.vendorName}</strong>
        <span className="feed-log-title">{item.title}</span>
      </div>
      <small>{item.detail}</small>
    </>
  );
}

export function OverviewBottomGrid({ data }: { data: DashboardData }) {
  return (
    <section className="bottom-grid">
      <OperationsPanel data={data} />
      <FeedPanel data={data} />
    </section>
  );
}

export function FeedPagePanels({ data }: { data: DashboardData }) {
  return (
    <>
      <FeedPanel data={data} expanded streamOnly />
    </>
  );
}

// ── Indicator primitives ─────────────────────────────────────────────────

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={cn("risk-badge", riskClass(level))}>{level}</span>;
}

export function RiskSignal({ level, label }: { level: RiskLevel; label?: string }) {
  return (
    <span className={cn("risk-signal", riskClass(level))}>
      <span className="risk-signal-dot" aria-hidden="true" />
      <span>{label ?? level}</span>
    </span>
  );
}

export function SeverityCell({ level }: { level: RiskLevel }) {
  const label = level === "CRITICAL" ? "Critical" : level.toLowerCase();
  return (
    <div className={cn("severity-cell", riskClass(level))}>
      <span className="severity-shape" aria-hidden="true">
        {shapeForRisk(level)}
      </span>
      <span className="severity-label">{label}</span>
    </div>
  );
}

export function SeverityTag({ level, label }: { level: RiskLevel; label: string }) {
  return <span className={cn("severity-tag", riskClass(level))}>{label}</span>;
}

// ── Vendor detail ────────────────────────────────────────────────────────

export function VendorDetailPage({ vendor }: { vendor: VendorProfile }) {
  const intelligence = [
    ...vendor.adverseEvents.map((event) => ({
      date: event.date,
      title: event.title,
      detail: event.description,
      href: event.sourceUrl,
    })),
    ...vendor.evidence.map((item) => ({
      date: item.publishedAt,
      title: item.title,
      detail: item.materiality,
      href: item.href,
    })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

  return (
    <div className="vendor-detail-layout">
      <section className="vendor-overview-grid">
        <div className="vendor-abstract">
          <div className="eyebrow">Abstract</div>
          <p className="vendor-summary">{vendor.summary}</p>
          <div className="detail-topline compact">
            <a href={vendor.vendorDomain} target="_blank" rel="noreferrer" className="domain-link">
              <Globe size={14} />
              {vendor.vendorDomain.replace("https://", "")}
            </a>
            <span>{priorityLabel(vendor.monitoringPriority)} priority</span>
            <span>Updated {formatDate(vendor.lastAssessmentDate)}</span>
          </div>
        </div>

        <aside className="vendor-stat-block">
          <div className="stat-row">
            <span className="detail-label">Score</span>
            <strong className="stat-number">{vendor.pending ? "—" : vendor.score}</strong>
          </div>
          <div className="stat-row">
            <span className="detail-label">Trend</span>
            <strong
              className={cn(
                "stat-trend",
                vendor.movement.trim().startsWith("-") ? "down" : "up",
              )}
            >
              {movementValue(vendor.movement)}
            </strong>
          </div>
          <div className="verdict-block">
            <span className="detail-label">Recommendation</span>
            <strong>
              <AlertTriangle size={14} />
              {recommendationLabel(vendor.recommendation)}
            </strong>
          </div>
        </aside>
      </section>

      <section className="vendor-analysis-grid">
        <section className="vendor-analysis-column">
          <div className="eyebrow">Risk vector analysis</div>
          <div className="dimension-lines">
            {vendor.dimensions.map((dimension) => (
              <div className="dimension-line" key={dimension.key}>
                <div className="dimension-line-head">
                  <strong>{dimension.label}</strong>
                  <RiskSignal level={dimension.severity} label={statusLabel(dimension.status)} />
                </div>
                <p>{dimension.findings}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="vendor-analysis-column intelligence-column">
          <div className="eyebrow">Latest intelligence</div>
          <div className="intelligence-list">
            {intelligence.length ? (
              intelligence.map((item) => (
                <a
                  className="intelligence-row"
                  href={item.href}
                  key={`${item.title}-${item.date}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <div className="intelligence-head">
                    <span className="intelligence-date">[{formatDate(item.date)}]</span>
                    <strong>{item.title}</strong>
                    <MoveUpRight size={13} />
                  </div>
                  <p>{item.detail}</p>
                </a>
              ))
            ) : (
              <div className="empty-card">No intelligence entries in the current monitoring window.</div>
            )}
          </div>
        </section>
      </section>
    </div>
  );
}
