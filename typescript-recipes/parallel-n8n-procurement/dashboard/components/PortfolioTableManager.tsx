"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useDashboardData } from "@/components/DashboardDataProvider";
import {
  type RiskDimension,
  type MonitoringPriority,
  type RiskLevel,
  type VendorProfile,
} from "@/lib/dashboard-types";

const STORAGE_KEY = "parallel-procurement-vendors";

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

function movementValue(movement: string) {
  return movement.match(/[+-]\d+/)?.[0] ?? movement;
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

function parseCsv(text: string, lastUpdated: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = csvCells(lines[0]).map((header) => header.toLowerCase());

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

function readStoredVendors(seedVendors: VendorProfile[]) {
  if (typeof window === "undefined") {
    return seedVendors;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return seedVendors;
  }

  try {
    const parsed = JSON.parse(raw) as VendorProfile[];
    return parsed.length ? parsed : seedVendors;
  } catch {
    return seedVendors;
  }
}

function mergeVendors(current: VendorProfile[], incoming: VendorProfile[]) {
  const merged = new Map(current.map((vendor) => [vendor.id, vendor]));
  incoming.forEach((vendor) => {
    merged.set(vendor.id, vendor);
  });
  return Array.from(merged.values()).sort((left, right) => right.score - left.score);
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
  const [rowMenuOpen, setRowMenuOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<VendorDraft>(defaultDraft);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manageMenuRef = useRef<HTMLDivElement>(null);
  const rowMenuRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  useEffect(() => {
    setVendors(readStoredVendors(data.vendors));
  }, [data.vendors]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(vendors));
  }, [vendors]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;

      if (manageMenuRef.current && !manageMenuRef.current.contains(target)) {
        setMenuOpen(false);
      }

      if (rowMenuOpen) {
        const activeRowMenu = rowMenuRefs.current[rowMenuOpen];
        if (activeRowMenu && !activeRowMenu.contains(target)) {
          setRowMenuOpen(null);
        }
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [rowMenuOpen]);

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
    setVendors(data.vendors);
  };

  const handleCsvUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const imported = parseCsv(text, data.lastUpdated);
    if (imported.length) {
      setVendors((current) => mergeVendors(current, imported));
    }
    event.target.value = "";
  };

  const handleAddVendor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const vendor = buildVendor(draft, data.lastUpdated);
    setVendors((current) => mergeVendors(current, [vendor]));
    setFormOpen(false);
  };

  const deleteVendor = (vendorId: string) => {
    const vendor = vendors.find((entry) => entry.id === vendorId);
    if (!vendor) return;
    if (!window.confirm(`Delete ${vendor.vendorName}?`)) return;
    setVendors((current) => current.filter((entry) => entry.id !== vendorId));
    setRowMenuOpen(null);
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
              <button type="button" onClick={openUpload}>
                <Upload size={14} />
                Upload CSV
              </button>
              <button type="button" onClick={openAdd}>
                <Plus size={14} />
                Add vendor
              </button>
              <button type="button" onClick={resetVendors}>
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
            <button type="submit">Save vendor</button>
            <button type="button" className="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

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
            <span className="row-menu-wrap" ref={(node) => { rowMenuRefs.current[vendor.id] = node; }}>
              <button
                type="button"
                className="row-menu-button"
                onClick={(event) => {
                  event.stopPropagation();
                  setRowMenuOpen((current) => (current === vendor.id ? null : vendor.id));
                }}
              >
                <MoreHorizontal size={16} />
              </button>
              {rowMenuOpen === vendor.id ? (
                <div className="row-menu">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteVendor(vendor.id);
                    }}
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

      <div className="portfolio-helper">
        CSV headers: <code>vendorName</code>, <code>vendorDomain</code>, <code>vendorCategory</code>, <code>relationshipOwner</code>, <code>region</code>, <code>monitoringPriority</code>, <code>riskLevel</code>, <code>score</code>, <code>nextResearchDate</code>.
      </div>
    </section>
  );
}
