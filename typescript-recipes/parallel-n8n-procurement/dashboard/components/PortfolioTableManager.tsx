"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Plus, RotateCcw, Upload } from "lucide-react";
import { useDashboardData } from "@/components/DashboardDataProvider";
import {
  type RiskDimension,
  type MonitoringPriority,
  type RiskLevel,
  type VendorProfile,
} from "@/lib/dashboard-types";
import type {
  PortfolioMutationRequest,
  PortfolioMutationResponse,
  PortfolioMutationVendorInput,
} from "@/lib/portfolio-mutations";

type VendorDraft = {
  vendorName: string;
  vendorDomain: string;
  vendorCategory: string;
  relationshipOwner: string;
  region: string;
  monitoringPriority: MonitoringPriority;
  riskLevel: RiskLevel;
  score: string;
  nextResearchDate: string;
};

const defaultDraft: VendorDraft = {
  vendorName: "",
  vendorDomain: "",
  vendorCategory: "",
  relationshipOwner: "",
  region: "",
  monitoringPriority: "medium",
  riskLevel: "MEDIUM",
  score: "50",
  nextResearchDate: "",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDate(input: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(input));
}

function normalizeRiskLevel(value: string | undefined): RiskLevel {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "LOW" || normalized === "MEDIUM" || normalized === "HIGH" || normalized === "CRITICAL") {
    return normalized;
  }
  return "MEDIUM";
}

function normalizePriority(value: string | undefined): MonitoringPriority {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  return "medium";
}

function csvCells(line: string) {
  return line
    .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
    .map((cell) => cell.trim().replace(/^"|"$/g, ""));
}

function csvHeaderKey(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function defaultDimensions(level: RiskLevel): RiskDimension[] {
  return [
    { key: "financial_health", label: "Financial health", severity: level, status: "watch", findings: "Imported vendor row pending review." },
    { key: "legal_regulatory", label: "Legal & regulatory", severity: "LOW" as RiskLevel, status: "stable", findings: "No imported legal details yet." },
    { key: "cybersecurity", label: "Cybersecurity", severity: "LOW" as RiskLevel, status: "stable", findings: "No imported cyber details yet." },
    { key: "leadership_governance", label: "Leadership & governance", severity: "LOW" as RiskLevel, status: "stable", findings: "No imported governance details yet." },
    { key: "esg_reputation", label: "ESG & reputation", severity: "LOW" as RiskLevel, status: "stable", findings: "No imported reputation details yet." },
  ];
}

function recommendationFor(level: RiskLevel) {
  if (level === "CRITICAL") return "suspend_relationship";
  if (level === "HIGH") return "initiate_contingency";
  if (level === "MEDIUM") return "escalate_review";
  return "continue_monitoring";
}

function buildVendor(draft: VendorDraft, lastUpdated: string): VendorProfile {
  const riskLevel = draft.riskLevel;
  const name = draft.vendorName.trim();
  const domain = draft.vendorDomain.trim();

  return {
    id: slugify(name),
    vendorName: name,
    vendorDomain: domain.startsWith("http") ? domain : `https://${domain}`,
    vendorCategory: draft.vendorCategory.trim().toLowerCase().replace(/\s+/g, "_"),
    monitoringPriority: draft.monitoringPriority,
    relationshipOwner: draft.relationshipOwner.trim(),
    region: draft.region.trim(),
    riskLevel,
    overallRiskLevel: riskLevel,
    score: Number(draft.score),
    actionRequired: riskLevel === "HIGH" || riskLevel === "CRITICAL",
    adverseFlag: riskLevel !== "LOW",
    recommendation: recommendationFor(riskLevel),
    summary: `${name} was added from portfolio management and is awaiting a full evidence review.`,
    movement: "+0 new vendor",
    lastAssessmentDate: lastUpdated.slice(0, 10),
    nextResearchDate: draft.nextResearchDate,
    triggeredOverrides: [],
    dimensions: defaultDimensions(riskLevel),
    adverseEvents: [],
    evidence: [],
    monitors: [],
  };
}

function vendorToMutationInput(vendor: VendorProfile): PortfolioMutationVendorInput {
  return {
    vendorName: vendor.vendorName,
    vendorDomain: vendor.vendorDomain,
    vendorCategory: vendor.vendorCategory,
    relationshipOwner: vendor.relationshipOwner,
    region: vendor.region,
    monitoringPriority: vendor.monitoringPriority,
    riskLevel: vendor.riskLevel,
    score: vendor.score,
    nextResearchDate: vendor.nextResearchDate,
  };
}

function parseCsv(text: string, lastUpdated: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = csvCells(lines[0]).map(csvHeaderKey);

  return lines.slice(1).map((line) => {
    const values = csvCells(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));

    const vendorName = row.vendorname || row.name;
    if (!vendorName) {
      return null;
    }

    return buildVendor(
      {
        vendorName,
        vendorDomain: row.vendordomain || row.domain || row.website || `${slugify(vendorName)}.com`,
        vendorCategory: row.vendorcategory || row.category || "vendor",
        relationshipOwner: row.relationshipowner || row.owner || "Unassigned",
        region: row.region || "Unassigned",
        monitoringPriority: normalizePriority(row.monitoringpriority || row.priority),
        riskLevel: normalizeRiskLevel(row.risklevel || row.level),
        score: row.score || "50",
        nextResearchDate: row.nextresearchdate || row.next || lastUpdated.slice(0, 10),
      },
      lastUpdated,
    );
  }).filter((vendor): vendor is VendorProfile => Boolean(vendor));
}

function RiskSignal({ level }: { level: RiskLevel }) {
  return (
    <span className={`risk-signal ${level.toLowerCase()}`}>
      <span className="risk-signal-dot" aria-hidden="true" />
      <span>{level}</span>
    </span>
  );
}

export function PortfolioTableManager() {
  const data = useDashboardData();
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorProfile[]>(data.vendors);
  const [menuOpen, setMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<VendorDraft>(defaultDraft);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PortfolioMutationRequest["action"] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manageMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVendors(data.vendors);
  }, [data.vendors]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;

      if (manageMenuRef.current && !manageMenuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const rows = useMemo(() => vendors.slice().sort((left, right) => right.score - left.score), [vendors]);

  const openUpload = () => {
    setMenuOpen(false);
    fileInputRef.current?.click();
  };

  const openAdd = () => {
    setMenuOpen(false);
    setDraft(defaultDraft);
    setFormOpen(true);
  };

  const resetVendors = () => {
    setMenuOpen(false);
    void runMutation({ action: "resetSeedVendors" }, "Demo portfolio restored from the backend seed set.");
  };

  const runMutation = async (request: PortfolioMutationRequest, successMessage: string) => {
    setPendingAction(request.action);
    setMutationError(null);
    setMutationMessage(null);

    try {
      const response = await fetch("/api/portfolio/mutation", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(request),
      });

      const body = (await response.json().catch(() => ({ ok: false, error: "Portfolio mutation returned invalid JSON." }))) as PortfolioMutationResponse;

      if (!response.ok || !body.ok) {
        throw new Error(body.error || `Portfolio mutation failed with HTTP ${response.status}.`);
      }

      setMutationMessage(successMessage);
      router.refresh();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Portfolio mutation failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleCsvUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const imported = parseCsv(text, data.lastUpdated);
    if (imported.length) {
      await runMutation(
        { action: "uploadVendors", vendors: imported.map(vendorToMutationInput) },
        `${imported.length} vendors uploaded through n8n.`,
      );
    } else {
      setMutationError("Upload did not contain any vendor rows.");
    }
    event.target.value = "";
  };

  const handleAddVendor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const vendor = buildVendor(draft, data.lastUpdated);
    void runMutation({ action: "addVendor", vendor: vendorToMutationInput(vendor) }, `${vendor.vendorName} saved through n8n.`);
    setFormOpen(false);
  };

  return (
    <section className="surface-panel portfolio-table-panel">
      <div className="table-toolbar">
        <div className="eyebrow">Portfolio</div>
        <div className="manage-menu-wrap" ref={manageMenuRef}>
          <button type="button" className="manage-menu-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>
            Manage vendors
            <MoreHorizontal size={16} />
          </button>
          {menuOpen ? (
            <div className="manage-menu">
              <button type="button" onClick={openUpload} disabled={Boolean(pendingAction)}>
                <Upload size={14} />
                Upload CSV
              </button>
              <button type="button" onClick={openAdd} disabled={Boolean(pendingAction)}>
                <Plus size={14} />
                Add vendor
              </button>
              <button type="button" onClick={resetVendors} disabled={Boolean(pendingAction)}>
                <RotateCcw size={14} />
                Reset demo data
              </button>
            </div>
          ) : null}
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleCsvUpload} className="sr-only" />
        </div>
      </div>

      {formOpen ? (
        <form className="vendor-form" onSubmit={handleAddVendor}>
          <input value={draft.vendorName} onChange={(event) => setDraft((current) => ({ ...current, vendorName: event.target.value }))} placeholder="Vendor name" required />
          <input value={draft.vendorDomain} onChange={(event) => setDraft((current) => ({ ...current, vendorDomain: event.target.value }))} placeholder="Domain" required />
          <input value={draft.vendorCategory} onChange={(event) => setDraft((current) => ({ ...current, vendorCategory: event.target.value }))} placeholder="Category" required />
          <input value={draft.relationshipOwner} onChange={(event) => setDraft((current) => ({ ...current, relationshipOwner: event.target.value }))} placeholder="Owner" required />
          <input value={draft.region} onChange={(event) => setDraft((current) => ({ ...current, region: event.target.value }))} placeholder="Region" required />
          <select value={draft.monitoringPriority} onChange={(event) => setDraft((current) => ({ ...current, monitoringPriority: event.target.value as MonitoringPriority }))}>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </select>
          <select value={draft.riskLevel} onChange={(event) => setDraft((current) => ({ ...current, riskLevel: event.target.value as RiskLevel }))}>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <input value={draft.score} onChange={(event) => setDraft((current) => ({ ...current, score: event.target.value }))} type="number" min="0" max="100" placeholder="Score" required />
          <input value={draft.nextResearchDate} onChange={(event) => setDraft((current) => ({ ...current, nextResearchDate: event.target.value }))} type="date" required />
          <div className="vendor-form-actions">
            <button type="submit" disabled={Boolean(pendingAction)}>Save vendor</button>
            <button type="button" className="secondary" onClick={() => setFormOpen(false)} disabled={Boolean(pendingAction)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {mutationError ? <div className="portfolio-status error" role="alert">{mutationError}</div> : null}
      {mutationMessage ? <div className="portfolio-status success" role="status">{mutationMessage}</div> : null}
      {pendingAction ? <div className="portfolio-status" role="status">Syncing portfolio changes through n8n...</div> : null}

      <div className="portfolio-table">
        <div className="portfolio-table-head">
          <span>Vendor</span>
          <span>Category</span>
          <span>Owner</span>
          <span>Region</span>
          <span>Level</span>
          <span>Score</span>
          <span>Next</span>
          <span>Status</span>
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
              <strong>{vendor.vendorName}</strong>
              <small>{vendor.vendorDomain.replace(/^https?:\/\//, "")}</small>
            </span>
            <span>{vendor.vendorCategory.replaceAll("_", " ")}</span>
            <span>{vendor.relationshipOwner}</span>
            <span>{vendor.region}</span>
            <span>
              <RiskSignal level={vendor.riskLevel} />
            </span>
            <span className="portfolio-score">{vendor.score}</span>
            <span>{formatDate(vendor.nextResearchDate)}</span>
            <span className="portfolio-sync-cell">n8n</span>
          </div>
        ))}
      </div>

      <div className="portfolio-helper">
        CSV headers: <code>vendorName</code>, <code>vendorDomain</code>, <code>vendorCategory</code>, <code>relationshipOwner</code>, <code>region</code>, <code>monitoringPriority</code>, <code>riskLevel</code>, <code>score</code>, <code>nextResearchDate</code>.
      </div>
    </section>
  );
}
