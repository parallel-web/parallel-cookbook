"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import type { MonitoringPriority, RiskLevel } from "@/lib/types/dashboard";

export interface PortfolioVendorRow {
  id: string;
  vendor_name: string;
  vendor_domain: string;
  vendor_category: string;
  relationship_owner: string;
  region: string;
  monitoring_priority: MonitoringPriority;
  risk_tier_override: RiskLevel | null;
  next_research_date: string | null;
  score: number | null;
  risk_level: RiskLevel | null;
  pending: boolean;
}

interface VendorDraft {
  vendorName: string;
  vendorDomain: string;
  vendorCategory: string;
  relationshipOwner: string;
  region: string;
  monitoringPriority: MonitoringPriority;
}

const defaultDraft: VendorDraft = {
  vendorName: "",
  vendorDomain: "",
  vendorCategory: "",
  relationshipOwner: "",
  region: "",
  monitoringPriority: "medium",
};

function formatDate(input: string | null) {
  if (!input) return "—";
  try {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
      new Date(input),
    );
  } catch {
    return input;
  }
}

function RiskSignal({ level }: { level: RiskLevel | null }) {
  if (!level) {
    return (
      <span className="risk-signal pending">
        <span className="risk-signal-dot" aria-hidden="true" />
        <span>PENDING</span>
      </span>
    );
  }
  return (
    <span className={`risk-signal ${level.toLowerCase()}`}>
      <span className="risk-signal-dot" aria-hidden="true" />
      <span>{level}</span>
    </span>
  );
}

export function PortfolioTableManager({
  initialVendors,
}: {
  initialVendors: PortfolioVendorRow[];
}) {
  const router = useRouter();
  const [vendors, setVendors] = useState<PortfolioVendorRow[]>(initialVendors);
  const [menuOpen, setMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [rowMenuOpen, setRowMenuOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<VendorDraft>(defaultDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manageMenuRef = useRef<HTMLDivElement>(null);
  const rowMenuRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (manageMenuRef.current && !manageMenuRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (rowMenuOpen) {
        const active = rowMenuRefs.current[rowMenuOpen];
        if (active && !active.contains(target)) setRowMenuOpen(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [rowMenuOpen]);

  const rows = useMemo(
    () =>
      vendors
        .slice()
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0)),
    [vendors],
  );

  async function refreshVendors() {
    const res = await fetch("/api/vendors", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { vendors: Array<Record<string, unknown>> };
    setVendors(
      (json.vendors ?? []).map((v) => ({
        id: String(v.id),
        vendor_name: String(v.vendor_name),
        vendor_domain: String(v.vendor_domain),
        vendor_category: String(v.vendor_category ?? "other"),
        relationship_owner: String(v.relationship_owner ?? ""),
        region: String(v.region ?? ""),
        monitoring_priority: (v.monitoring_priority as MonitoringPriority) ?? "medium",
        risk_tier_override: (v.risk_tier_override as RiskLevel | null) ?? null,
        next_research_date: (v.next_research_date as string | null) ?? null,
        score: null,
        risk_level: null,
        pending: true,
      })),
    );
  }

  function openUpload() {
    setMenuOpen(false);
    fileInputRef.current?.click();
  }

  function openAdd() {
    setMenuOpen(false);
    setDraft(defaultDraft);
    setError(null);
    setFormOpen(true);
  }

  async function handleCsvUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setBusy("import");
    setError(null);
    try {
      const res = await fetch("/api/vendors/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      await refreshVendors();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      event.target.value = "";
    }
  }

  async function handleAddVendor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("add");
    setError(null);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      setFormOpen(false);
      setDraft(defaultDraft);
      await refreshVendors();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteVendor(vendorId: string) {
    const v = vendors.find((entry) => entry.id === vendorId);
    if (!v) return;
    if (!window.confirm(`Delete ${v.vendor_name}?`)) return;
    setBusy(`delete:${vendorId}`);
    try {
      const res = await fetch(`/api/vendors/${vendorId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setVendors((current) => current.filter((entry) => entry.id !== vendorId));
      setRowMenuOpen(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runResearch(vendorId: string) {
    setBusy(`research:${vendorId}`);
    setError(null);
    setRowMenuOpen(null);
    try {
      const res = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorIds: [vendorId] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deployMonitors(vendorId: string) {
    setBusy(`monitors:${vendorId}`);
    setError(null);
    setRowMenuOpen(null);
    try {
      const res = await fetch("/api/monitors/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorIds: [vendorId] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="surface-panel portfolio-table-panel">
      <div className="table-toolbar">
        <div className="eyebrow">Portfolio</div>
        <div className="manage-menu-wrap" ref={manageMenuRef}>
          <button
            type="button"
            className="manage-menu-button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            Manage vendors
            <MoreHorizontal size={16} />
          </button>
          {menuOpen ? (
            <div className="manage-menu">
              <button type="button" onClick={openUpload}>
                <Upload size={14} />
                Upload CSV
              </button>
              <button type="button" onClick={openAdd}>
                <Plus size={14} />
                Add vendor
              </button>
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvUpload}
            className="sr-only"
          />
        </div>
      </div>

      {error ? <div className="portfolio-error">{error}</div> : null}

      {formOpen ? (
        <form className="vendor-form" onSubmit={handleAddVendor}>
          <input
            value={draft.vendorName}
            onChange={(e) => setDraft((c) => ({ ...c, vendorName: e.target.value }))}
            placeholder="Vendor name"
            required
          />
          <input
            value={draft.vendorDomain}
            onChange={(e) => setDraft((c) => ({ ...c, vendorDomain: e.target.value }))}
            placeholder="Domain (e.g. acme.com)"
            required
          />
          <input
            value={draft.vendorCategory}
            onChange={(e) => setDraft((c) => ({ ...c, vendorCategory: e.target.value }))}
            placeholder="Category"
          />
          <input
            value={draft.relationshipOwner}
            onChange={(e) =>
              setDraft((c) => ({ ...c, relationshipOwner: e.target.value }))
            }
            placeholder="Owner"
          />
          <input
            value={draft.region}
            onChange={(e) => setDraft((c) => ({ ...c, region: e.target.value }))}
            placeholder="Region"
          />
          <select
            value={draft.monitoringPriority}
            onChange={(e) =>
              setDraft((c) => ({
                ...c,
                monitoringPriority: e.target.value as MonitoringPriority,
              }))
            }
          >
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </select>
          <div className="vendor-form-actions">
            <button type="submit" disabled={busy === "add"}>
              {busy === "add" ? "Saving…" : "Save vendor"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <div className="empty-state">
          <strong>No vendors yet</strong>
          <p>Add your first vendor or upload a CSV to begin monitoring.</p>
        </div>
      ) : (
        <div className="portfolio-table">
          <div className="portfolio-table-head">
            <span>Vendor</span>
            <span>Category</span>
            <span>Owner</span>
            <span>Region</span>
            <span>Level</span>
            <span>Score</span>
            <span>Next</span>
            <span>Manage</span>
          </div>

          {rows.map((vendor) => (
            <div
              key={vendor.id}
              className="portfolio-table-row"
              role="link"
              tabIndex={0}
              onClick={() => router.push(`/vendors/${vendor.id}`)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  router.push(`/vendors/${vendor.id}`);
                }
              }}
            >
              <span className="portfolio-vendor-cell">
                <strong>{vendor.vendor_name}</strong>
                <small>{vendor.vendor_domain.replace(/^https?:\/\//, "")}</small>
              </span>
              <span>{vendor.vendor_category.replaceAll("_", " ")}</span>
              <span>{vendor.relationship_owner || "—"}</span>
              <span>{vendor.region || "—"}</span>
              <span>
                <RiskSignal level={vendor.risk_level} />
              </span>
              <span className="portfolio-score">
                {vendor.score == null ? "—" : vendor.score}
              </span>
              <span>{formatDate(vendor.next_research_date)}</span>
              <span
                className="row-menu-wrap"
                ref={(node) => {
                  rowMenuRefs.current[vendor.id] = node;
                }}
              >
                <button
                  type="button"
                  className="row-menu-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setRowMenuOpen((current) =>
                      current === vendor.id ? null : vendor.id,
                    );
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
                {rowMenuOpen === vendor.id ? (
                  <div className="row-menu" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => runResearch(vendor.id)}
                      disabled={busy?.startsWith("research")}
                    >
                      <RefreshCw size={14} />
                      Run research
                    </button>
                    <button
                      type="button"
                      onClick={() => deployMonitors(vendor.id)}
                      disabled={busy?.startsWith("monitors")}
                    >
                      <Activity size={14} />
                      Deploy monitors
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteVendor(vendor.id)}
                      disabled={busy === `delete:${vendor.id}`}
                    >
                      <Trash2 size={14} />
                      Delete vendor
                    </button>
                  </div>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="portfolio-helper">
        CSV headers: <code>vendorName</code>, <code>vendorDomain</code>,{" "}
        <code>vendorCategory</code>, <code>relationshipOwner</code>, <code>region</code>,{" "}
        <code>monitoringPriority</code>.
      </div>
    </section>
  );
}
