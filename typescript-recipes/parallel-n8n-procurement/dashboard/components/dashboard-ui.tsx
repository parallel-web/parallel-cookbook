"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Download, Globe, MoveUpRight, Share2 } from "lucide-react";
import { DashboardDataProvider, useDashboardData } from "@/components/DashboardDataProvider";
import { dimensionOrder, type DashboardData, type RiskLevel, type VendorProfile } from "@/lib/dashboard-types";

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

export function formatDate(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input || "Not scheduled";

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatUpdatedTime(input: string) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "unavailable";

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(date);
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

function vendorDisplayId(vendor: VendorProfile) {
  const filtered = vendor.vendorName
    .split(/\s+/)
    .filter((token) => !["corp", "solutions", "partners", "logistics", "manufacturing"].includes(token.toLowerCase()));
  const seed = filtered[0] ?? vendor.vendorName;
  const capitals = seed.match(/[A-Z]/g)?.join("") ?? "";
  const prefix = (capitals || seed.replace(/[^A-Za-z]/g, "").slice(0, 2)).toUpperCase().slice(0, 2);
  return `${prefix}-${String(vendor.score).padStart(3, "0")}`;
}

function feedLogTimestamp(relativeTimestamp: string, lastUpdated: string) {
  const base = new Date(lastUpdated);
  if (Number.isNaN(base.getTime())) return "--:--";

  const minuteMatch = relativeTimestamp.match(/(\d+)\s+minute/);
  const hourMatch = relativeTimestamp.match(/(\d+)\s+hour/);

  if (minuteMatch) {
    base.setUTCMinutes(base.getUTCMinutes() - Number(minuteMatch[1]));
  } else if (hourMatch) {
    base.setUTCHours(base.getUTCHours() - Number(hourMatch[1]));
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(base);
}

function shapeForRisk(level: RiskLevel) {
  if (level === "LOW") return "●";
  if (level === "MEDIUM") return "▲";
  if (level === "HIGH") return "■";
  return "◆";
}

export function getVendorById(data: DashboardData, vendorId: string) {
  return data.vendors.find((vendor) => vendor.id === vendorId);
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

export function DashboardShell({
  data,
  section,
  title,
  subtitle,
  children,
  aside,
  breadcrumb,
  breadcrumbItems,
  headerMeta,
  headerMetaItems,
}: {
  data?: DashboardData;
  section: SectionId;
  title: string;
  subtitle: string;
  children: ReactNode;
  aside?: ReactNode;
  breadcrumb?: ReactNode;
  breadcrumbItems?: Array<{ label: string; href?: string }>;
  headerMeta?: ReactNode;
  headerMetaItems?: string[];
}) {
  const renderedBreadcrumb = breadcrumbItems ? (
    <span className="page-breadcrumb-group">
      {breadcrumbItems.map((item, index) => (
        <span key={`${item.label}-${index}`} className="page-breadcrumb-item">
          {index > 0 ? <span>/</span> : null}
          {item.href ? (
            <Link href={item.href} className="page-breadcrumb-link">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
        </span>
      ))}
    </span>
  ) : (
    breadcrumb
  );
  const renderedHeaderMeta = headerMetaItems ? (
    <div className="page-meta vendor-meta-bar">
      {headerMetaItems.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  ) : (
    headerMeta
  );

  const shell = (
    <div className="dashboard-shell app-shell">
      <header className="app-header">
        <div className="app-header-bar">
          <Link href="/" className="app-brand">
            Parallel Procurement
          </Link>
          <nav className="app-nav" aria-label="Primary">
            {navigation.map((item) => (
              <Link key={item.id} href={item.href} className={cn("app-nav-link", item.id === section && "active")}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className={cn("page-header", aside ? "has-aside" : undefined)}>
          <div className="page-header-copy">
            {renderedBreadcrumb ? <div className="page-breadcrumb">{renderedBreadcrumb}</div> : null}
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
            {renderedHeaderMeta ? renderedHeaderMeta : <div className="page-meta"><span>{data ? `Updated ${formatUpdatedTime(data.lastUpdated)} UTC` : "Snapshot unavailable"}</span></div>}
          </div>
          {aside ? <div className="page-header-aside">{aside}</div> : null}
        </div>
      </header>

      <main className="page-content">{children}</main>
    </div>
  );

  return data ? <DashboardDataProvider data={data}>{shell}</DashboardDataProvider> : shell;
}

export function ActionCard() {
  const data = useDashboardData();
  const firstCriticalVendor =
    data.vendors.find((vendor) => vendor.riskLevel === "CRITICAL") ?? data.vendors[0];
  const actionRequiredCount = data.vendors.filter((vendor) => vendor.actionRequired).length;

  if (!firstCriticalVendor) {
    return (
      <div className="action-card">
        <span className="meta-label">Action required</span>
        <strong>No vendors in the live snapshot</strong>
        <span className="action-card-button">Sync vendor registry</span>
      </div>
    );
  }

  return (
    <Link href={`/vendors/${firstCriticalVendor.id}`} className="action-card">
      <span className="meta-label">Action required</span>
      <strong>{actionRequiredCount} vendors need attention</strong>
      <span className="action-card-button">Open highest-priority vendor</span>
    </Link>
  );
}

export function MetricsBand() {
  const data = useDashboardData();

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
          {data.researchSummary.totalDue} vendors were due for review. {data.researchSummary.totalFailed}{" "}
          stayed queued after failed runs, and {data.researchSummary.adverseCount} showed adverse conditions.
        </p>
      </div>
    </section>
  );
}

export function ImmediateAttentionPreview() {
  const data = useDashboardData();
  const actionRequiredCount = data.vendors.filter((vendor) => vendor.actionRequired).length;

  return (
    <section className="surface-panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Priority notes ({actionRequiredCount})</div>
        </div>
        <Link href="/attention" className="text-link">
          Review all <ArrowRight size={14} />
        </Link>
      </div>

      <div className="priority-list">
        {data.actionQueue.slice(0, 3).map((item) => {
          const vendor = data.vendors.find((entry) => entry.vendorName === item.vendorName);

          return (
            <Link key={`${item.vendorName}-${item.deadline}`} href={`/vendors/${vendor?.id ?? ""}`} className="priority-item">
              <div className="priority-item-top">
                <strong>{item.vendorName}</strong>
                <div className="priority-item-meta">
                  <span className="priority-deadline">{item.deadline}</span>
                  <RiskSignal level={item.riskLevel} />
                </div>
              </div>
              <p>{item.action}</p>
            </Link>
          );
        })}
        {!data.actionQueue.length ? <div className="empty-card">No immediate actions in the current live snapshot.</div> : null}
      </div>
    </section>
  );
}

export function AttentionQueuePage() {
  const data = useDashboardData();

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

        {data.actionQueue.map((item) => {
          const vendor = data.vendors.find((entry) => entry.vendorName === item.vendorName);

          return (
            <Link key={`${item.vendorName}-${item.deadline}`} href={`/vendors/${vendor?.id ?? ""}`} className="attention-row">
              <span className="attention-vendor">
                <strong>{item.vendorName}</strong>
                <small>{vendor?.relationshipOwner}</small>
              </span>
              <span>{item.owner}</span>
              <span>{item.deadline}</span>
              <span>
                <RiskSignal level={item.riskLevel} />
              </span>
              <span>{item.action}</span>
            </Link>
          );
        })}
      </div>
      {!data.actionQueue.length ? <div className="empty-card">No action queue entries in the current live snapshot.</div> : null}
    </section>
  );
}

export function WatchlistTable({ limit }: { limit?: number }) {
  const data = useDashboardData();
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
          <Link key={vendor.id} href={`/vendors/${vendor.id}`} className={cn("watchlist-row", vendor.riskLevel === "CRITICAL" && "critical-row")}>
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
                <SeverityTag key={`${vendor.id}-${dimension.key}`} level={dimension.severity} label={driverLabel(dimension.label)} />
              ))}
            </span>
            <span className="score-cell">
              <strong>{vendor.score}</strong>
            </span>
            <span>{formatDate(vendor.nextResearchDate)}</span>
            <span className={cn("movement-cell", vendor.movement.trim().startsWith("-") ? "down" : "up")}>
              <strong>{movementValue(vendor.movement)}</strong>
            </span>
          </Link>
        ))}
        {!vendors.length ? <div className="empty-card">No vendors in the current live snapshot.</div> : null}
      </div>
    </section>
  );
}

export function RiskMatrixPanel() {
  const data = useDashboardData();

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
          <Link key={vendor.id} href={`/vendors/${vendor.id}`} className={cn("matrix-row", vendor.riskLevel === "CRITICAL" && "critical-row")}>
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
      {!data.vendors.length ? <div className="empty-card">No vendors in the current live snapshot.</div> : null}
    </section>
  );
}

export function OperationsPanel() {
  const data = useDashboardData();

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

export function FeedPanel({ expanded = false, streamOnly = false }: { expanded?: boolean; streamOnly?: boolean }) {
  const data = useDashboardData();
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
        {items.map((item) => (
          <a className="feed-item" href={item.sourceUrl} key={`${item.vendorName}-${item.title}`} target="_blank" rel="noreferrer">
            <div className="feed-log-line">
              <span className="feed-log-time">[{feedLogTimestamp(item.timestamp, data.lastUpdated)} UTC]</span>
              <strong>{item.vendorName}</strong>
              <span className="feed-log-title">{item.title}</span>
            </div>
            <small>{item.detail}</small>
          </a>
        ))}
        {!items.length ? <div className="empty-card">No feed events in the current live snapshot.</div> : null}
      </div>
    </section>
  );
}

export function FeedSharePanel() {
  return (
    <section className="surface-panel feed-share-panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Share feed</div>
          <h2>Distribute this intelligence snapshot</h2>
        </div>
      </div>

      <div className="feed-share-grid">
        <article className="feed-share-card">
          <div className="feed-share-head">
            <strong>Download package</strong>
            <span>Single export</span>
          </div>
          <p>Bundle this feed as one downloadable brief including all visible items and source links.</p>
          <button type="button" className="feed-share-button">
            <Download size={14} />
            Download feed package
          </button>
        </article>

        <article className="feed-share-card">
          <div className="feed-share-head">
            <strong>Share to Slack</strong>
            <span>One-click post</span>
          </div>
          <p>Send this feed summary to a channel with key events, severity highlights, and linked sources.</p>
          <button type="button" className="feed-share-button secondary">
            <Share2 size={14} />
            Share to Slack
          </button>
        </article>
      </div>

      <p className="feed-share-note">
        UI-only preview: download and Slack actions are intentionally not wired yet.
      </p>
    </section>
  );
}

export function OverviewBottomGrid() {
  return (
    <section className="bottom-grid">
      <OperationsPanel />
      <FeedPanel />
    </section>
  );
}

export function FeedPagePanels() {
  return (
    <>
      <FeedSharePanel />
      <FeedPanel expanded streamOnly />
    </>
  );
}

export function DashboardSetupState({ message, detail }: { message: string; detail?: string }) {
  return (
    <section className="surface-panel setup-state" role="status">
      <div>
        <div className="eyebrow">Live snapshot required</div>
        <h2>{message}</h2>
      </div>
      {detail ? <p>{detail}</p> : null}
      <div className="setup-state-code">PROCUREMENT_DASHBOARD_SNAPSHOT_URL</div>
    </section>
  );
}

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
            <strong className="stat-number">{vendor.score}</strong>
          </div>
          <div className="stat-row">
            <span className="detail-label">Trend</span>
            <strong className={cn("stat-trend", vendor.movement.trim().startsWith("-") ? "down" : "up")}>
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
              intelligence.map((item, index) => (
                <a className="intelligence-row" href={item.href} key={`${item.title}-${item.date}-${item.href}-${index}`} target="_blank" rel="noreferrer">
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
