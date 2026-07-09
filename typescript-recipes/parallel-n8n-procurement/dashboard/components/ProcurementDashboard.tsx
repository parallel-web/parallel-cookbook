"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Globe, MoveUpRight, X } from "lucide-react";
import { dimensionOrder, type DashboardData, type RiskLevel, type VendorProfile } from "@/lib/dashboard-types";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDate(input: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(input));
}

function formatUpdatedTime(input: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  }).format(new Date(input));
}

function riskClass(level: RiskLevel) {
  return level.toLowerCase();
}

function priorityLabel(priority: VendorProfile["monitoringPriority"]) {
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function recommendationLabel(recommendation: string) {
  return recommendation.replaceAll("_", " ");
}

function movementValue(movement: string) {
  return movement.match(/[+-]\d+/)?.[0] ?? movement;
}

function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={cn("risk-badge", riskClass(level))}>{level}</span>;
}

function SeverityCell({ level }: { level: RiskLevel }) {
  const shape = level === "LOW" ? "●" : level === "MEDIUM" ? "▲" : level === "HIGH" ? "■" : "◆";
  const label = level === "CRITICAL" ? "Critical" : level.toLowerCase();

  return (
    <div className={cn("severity-cell", riskClass(level))}>
      <span className="severity-shape" aria-hidden="true">
        {shape}
      </span>
      <span className="severity-label">{label}</span>
    </div>
  );
}

export function ProcurementDashboard({ data }: { data: DashboardData }) {
  const initialVendor =
    data.vendors.find((vendor) => vendor.riskLevel === "CRITICAL") ?? data.vendors[0];
  const [selectedVendorId, setSelectedVendorId] = useState(initialVendor?.id ?? "");
  const [detailOpen, setDetailOpen] = useState(false);

  const selectedVendor = useMemo(
    () => data.vendors.find((vendor) => vendor.id === selectedVendorId) ?? initialVendor,
    [data.vendors, selectedVendorId],
  );

  const actionRequiredCount = data.vendors.filter((vendor) => vendor.actionRequired).length;
  const firstCriticalVendor =
    data.vendors.find((vendor) => vendor.riskLevel === "CRITICAL") ?? initialVendor;

  if (!selectedVendor || !firstCriticalVendor) {
    return <div className="dashboard-shell">No vendors in the current live snapshot.</div>;
  }

  const openVendor = (vendorId: string) => {
    setSelectedVendorId(vendorId);
    setDetailOpen(true);
  };

  return (
    <div className="dashboard-shell">
      <header className="topbar">
        <section className="priority-notes">
          <div className="eyebrow">Priority notes</div>
          <h2>Immediate attention</h2>
          <div className="priority-context">
            <span>Updated {formatUpdatedTime(data.lastUpdated)} UTC</span>
            <span>{data.researchSummary.totalResearched} research runs completed</span>
          </div>
          <div className="priority-list">
            {data.actionQueue.slice(0, 3).map((item) => (
              <button
                key={`${item.vendorName}-${item.deadline}`}
                className="priority-item"
                type="button"
                onClick={() => {
                  const vendor = data.vendors.find((entry) => entry.vendorName === item.vendorName);
                  if (vendor) openVendor(vendor.id);
                }}
              >
                <div className="priority-item-top">
                  <strong>{item.vendorName}</strong>
                </div>
                <div className="priority-item-meta">{item.deadline}</div>
                <p>{item.action}</p>
              </button>
            ))}
          </div>
        </section>

        <aside className="topbar-meta">
          <button
            className="attention-button"
            type="button"
            onClick={() => openVendor(firstCriticalVendor.id)}
          >
            <span className="meta-label">Action required</span>
            <strong>{actionRequiredCount} vendors need attention</strong>
            <span className="attention-button-copy">Review highest-priority vendor</span>
          </button>
        </aside>
      </header>

      <section className="summary-band">
        <div className="summary-metrics">
          {data.metrics.map((metric) => (
            <div key={metric.label} className="metric-card">
              <span className="metric-card-label">{metric.label}</span>
              <strong className="metric-card-value">{metric.value}</strong>
              <p className="metric-card-trend">{metric.trend}</p>
            </div>
          ))}
        </div>
        <div className="summary-note">
          <span className="eyebrow">Today</span>
          <p>
            {data.researchSummary.totalDue} vendors were due for review.{" "}
            {data.researchSummary.totalFailed} stayed queued after failed runs, and{" "}
            {data.researchSummary.adverseCount} showed adverse conditions.
          </p>
        </div>
      </section>

      <main className="portfolio-surface">
        <section className="panel portfolio-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Portfolio</div>
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
              <button
                key={vendor.id}
                className={cn(
                  "matrix-row",
                  vendor.id === selectedVendorId && "selected",
                  vendor.riskLevel === "CRITICAL" && "critical-row",
                )}
                onClick={() => setSelectedVendorId(vendor.id)}
                type="button"
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
              </button>
            ))}
          </div>

          <div className="roster-block">
            <div className="roster-header">
              <div>
                <div className="eyebrow">Roster</div>
                <h3>Vendor list</h3>
              </div>
            </div>

            <div className="roster-table">
              <div className="roster-head">
                <span>Vendor</span>
                <span>Owner</span>
                <span>Score</span>
                <span>Risk</span>
                <span>Next</span>
                <span>Movement</span>
              </div>

              {data.vendors.map((vendor) => (
                <button
                  key={vendor.id}
                  className={cn("roster-row", vendor.id === selectedVendorId && "selected")}
                  onClick={() => openVendor(vendor.id)}
                  type="button"
                >
                  <span className="roster-vendor">
                    <strong>{vendor.vendorName}</strong>
                    <small>{vendor.vendorCategory.replaceAll("_", " ")}</small>
                  </span>
                  <span>{vendor.relationshipOwner}</span>
                  <span className="score-cell">
                    <strong>{vendor.score}</strong>
                  </span>
                  <span className="risk-cell">
                    <RiskBadge level={vendor.riskLevel} />
                  </span>
                  <span>{formatDate(vendor.nextResearchDate)}</span>
                  <span className={cn("movement-cell", vendor.movement.trim().startsWith("-") ? "down" : "up")}>
                    <strong>{movementValue(vendor.movement)}</strong>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>

      <section className="bottom-grid">
        <section className="panel">
          <div className="panel-header compact">
            <div>
              <div className="eyebrow">Operations</div>
              <h2>Fleet health</h2>
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

        <section className="panel">
          <div className="panel-header compact">
            <div>
              <div className="eyebrow">Feed</div>
              <h2>Latest monitor detections</h2>
            </div>
          </div>

          <div className="feed-list">
            {data.feed.map((item) => (
              <a
                className="feed-item"
                href={item.sourceUrl}
                key={`${item.vendorName}-${item.title}`}
                target="_blank"
                rel="noreferrer"
              >
                <div className="feed-item-top">
                  <strong>{item.vendorName}</strong>
                  <span>{item.timestamp}</span>
                </div>
                <p>{item.title}</p>
                <small>{item.detail}</small>
              </a>
            ))}
          </div>
        </section>
      </section>

      <footer className="footer-note">Built as an evidence-first review surface for procurement teams.</footer>

      {detailOpen ? (
        <div className="detail-modal-backdrop" onClick={() => setDetailOpen(false)} role="presentation">
          <aside
            className="detail-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedVendor.vendorName} details`}
          >
            <div className="detail-modal-header">
              <div className="detail-title-block">
                <div className="eyebrow">Vendor detail</div>
                <div className="detail-title-row">
                  <h2>{selectedVendor.vendorName}</h2>
                  <RiskBadge level={selectedVendor.riskLevel} />
                </div>
              </div>
              <button className="close-button" type="button" onClick={() => setDetailOpen(false)} aria-label="Close details">
                <X size={18} />
                <span>Close</span>
              </button>
            </div>

            <div className="detail-topline">
              <a href={selectedVendor.vendorDomain} target="_blank" rel="noreferrer" className="domain-link">
                <Globe size={14} />
                {selectedVendor.vendorDomain.replace("https://", "")}
              </a>
              <span>{selectedVendor.relationshipOwner}</span>
              <span>{priorityLabel(selectedVendor.monitoringPriority)} priority</span>
              <span>{selectedVendor.region}</span>
            </div>

            <p className="vendor-summary">{selectedVendor.summary}</p>

            <div className="detail-kpis">
              <div className="recommendation-card">
                <span className="detail-label">Recommendation</span>
                <strong>{recommendationLabel(selectedVendor.recommendation)}</strong>
              </div>
              <div>
                <span className="detail-label">Last assessment</span>
                <strong>{formatDate(selectedVendor.lastAssessmentDate)}</strong>
              </div>
              <div>
                <span className="detail-label">Next research</span>
                <strong>{formatDate(selectedVendor.nextResearchDate)}</strong>
              </div>
              <div>
                <span className="detail-label">Overrides</span>
                <strong>{selectedVendor.triggeredOverrides.length || "None"}</strong>
              </div>
            </div>

            <div className="detail-sections">
              <section className="detail-section">
                <div className="section-title-row">
                  <div>
                    <div className="eyebrow">Assessment</div>
                    <h3>Risk dimensions</h3>
                  </div>
                </div>

                <div className="dimension-stack">
                  {selectedVendor.dimensions.map((dimension) => (
                    <div className="dimension-card" key={dimension.key}>
                      <div className="dimension-card-top">
                        <div className="dimension-card-heading">
                          <strong className="dimension-title">{dimension.label}</strong>
                          <span className="detail-status">{dimension.status.replaceAll("_", " ")}</span>
                        </div>
                        <RiskBadge level={dimension.severity} />
                      </div>
                      <p>{dimension.findings}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="detail-section">
                <div className="section-title-row">
                  <div>
                    <div className="eyebrow">Evidence</div>
                    <h3>Adverse events and sources</h3>
                  </div>
                </div>

                {selectedVendor.adverseEvents.length ? (
                  <div className="event-list">
                    {selectedVendor.adverseEvents.map((event) => (
                      <a
                        className="event-card"
                        href={event.sourceUrl}
                        key={`${event.title}-${event.date}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <div className="event-card-top">
                          <RiskBadge level={event.severity} />
                          <span>{formatDate(event.date)}</span>
                        </div>
                        <strong>{event.title}</strong>
                        <p>{event.description}</p>
                        <span className="event-link">
                          Source <ArrowUpRight size={13} />
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="empty-card">No adverse events in the current monitoring window.</div>
                )}

                <div className="evidence-list">
                  {selectedVendor.evidence.map((item) => (
                    <a className="evidence-item" href={item.href} key={item.title} target="_blank" rel="noreferrer">
                      <div className="evidence-item-top">
                        <strong>{item.title}</strong>
                        <MoveUpRight size={14} />
                      </div>
                      <p>{item.materiality}</p>
                      <small>
                        {item.publication} · {formatDate(item.publishedAt)}
                      </small>
                    </a>
                  ))}
                </div>
              </section>

              <section className="detail-section">
                <div className="section-title-row">
                  <div>
                    <div className="eyebrow">Monitoring</div>
                    <h3>Active monitor lenses</h3>
                  </div>
                </div>

                <div className="monitor-stack">
                  {selectedVendor.monitors.map((monitor) => (
                    <div className="monitor-row" key={`${selectedVendor.id}-${monitor.dimension}`}>
                      <div className="monitor-row-head">
                        <strong>{monitor.dimension}</strong>
                        <span className={cn("monitor-status", monitor.status)}>
                          {monitor.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p>{monitor.query}</p>
                      <small>
                        {monitor.cadence} cadence · last signal {monitor.lastEvent}
                      </small>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
