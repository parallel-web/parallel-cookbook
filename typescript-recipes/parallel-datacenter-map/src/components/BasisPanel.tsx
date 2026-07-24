"use client";

import { useState, useEffect } from "react";
import { ExternalLink, X, Code, Loader2, RefreshCw } from "lucide-react";
import { CopyCodeBlock } from "./CopyCodeBlock";
import { timeAgo } from "@/lib/utils";

function fmtValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface BasisPanelData {
  field: string;
  value: string;
  facilityName: string;
  facilityIndex: number;
  citations: { field: string; url: string; title: string }[];
  reasoning?: string;
  /** "ai" = AI classification (client-side data, skip the enrichment fetch) */
  source?: "enrichment" | "ai";
  /** Present when a snapshot re-verification changed this field. Carries the
   *  re-verification run's own reasoning + sources (which explain the NEW
   *  value, unlike the stale pre-update enrichment basis). */
  update?: {
    from?: unknown;
    to?: unknown;
    timestamp?: string;
    reasoning?: string;
    citations?: { field: string; url: string; title: string }[];
  };
}

interface FullBasis {
  citations: { field: string; url: string; title: string; excerpts?: string[] }[];
  reasoning: string;
}

interface BasisPanelProps {
  data: BasisPanelData | null;
  onClose: () => void;
}

export function BasisPanel({ data, onClose }: BasisPanelProps) {
  const [showCode, setShowCode] = useState(false);
  const [fullBasis, setFullBasis] = useState<FullBasis | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch full basis from API when panel opens or data changes.
  // AI classifications carry their own citations client-side, and
  // snapshot-updated fields carry the re-verification run's basis — in both
  // cases skip the enrichment-blob fetch (which describes the OLD value).
  useEffect(() => {
    if (!data || data.source === "ai" || data.update) {
      setFullBasis(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFullBasis(null);

    fetch(`/api/basis?facility=${data.facilityIndex}&field=${encodeURIComponent(data.field)}`)
      .then((r) => r.json())
      .then((d) => {
        setFullBasis(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [data?.facilityIndex, data?.field, data]);

  if (!data) return null;

  // For a snapshot-updated field, the current value IS update.to and the
  // reasoning/citations come from the re-verification run — never the stale
  // enrichment basis.
  const displayValue =
    data.update && data.update.to !== undefined
      ? fmtValue(data.update.to)
      : data.value || "—";
  const reasoning = data.update?.reasoning || fullBasis?.reasoning || data.reasoning || "";
  const citations =
    data.update?.citations ||
    fullBasis?.citations ||
    data.citations.filter((c) => c.field === data.field || c.field === "");
  const uniqueCitations = Array.from(
    new Map(citations.map((c) => [c.url, c])).values()
  );

  return (
    <div className="w-[420px] shrink-0 border-l border-[#E5E5E5] bg-white flex flex-col h-full animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-4 border-b border-[#E5E5E5] shrink-0">
        <div className="min-w-0 flex-1">
          <div className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#ADADAC] mb-1">
            {data.field.replace(/_/g, " ")}
          </div>
          <div className="text-[16px] font-medium text-[#1D1B16] leading-[20px]">
            {data.facilityName}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-[#ADADAC] hover:text-[#1D1B16] transition-colors p-1 shrink-0 ml-2"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Value */}
      <div className="px-6 py-3 border-b border-[#E5E5E5] shrink-0 bg-[#F9F8F4]">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#ADADAC]">
            Value
          </span>
          {data.update && (
            <span className="inline-flex items-center gap-1 font-mono uppercase text-[7px] tracking-[0.05em] text-[#FB631B] bg-[#FCDDCF] px-1.5 py-0.5 rounded-[2px]">
              <RefreshCw className="w-2 h-2" /> Updated
            </span>
          )}
        </div>
        <div className="text-[13px] text-[#1D1B16] leading-[20px]">
          {displayValue}
        </div>
      </div>

      {/* Snapshot re-verification change */}
      {data.update && (
        <div className="px-6 py-4 border-b border-[#E5E5E5] shrink-0 bg-[#FCDDCF]/20">
          <div className="flex items-center gap-1.5 mb-2.5">
            <RefreshCw className="w-3 h-3 text-[#FB631B]" />
            <span className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#FB631B]">
              Updated by snapshot re-verification
            </span>
            {data.update.timestamp && (
              <span className="font-mono text-[8px] text-[#A6A5A4] ml-auto">{timeAgo(data.update.timestamp)}</span>
            )}
          </div>
          {data.update.from !== undefined || data.update.to !== undefined ? (
            <div className="space-y-1.5">
              <div className="rounded-[4px] border border-[#E5E5E5] bg-white px-3 py-2">
                <div className="font-mono uppercase text-[7px] tracking-[0.05em] text-[#A6A5A4] mb-1">Previous value</div>
                <div className="text-[12px] text-[#A6A5A4] line-through leading-[16px] break-words">{fmtValue(data.update.from)}</div>
              </div>
              <div className="flex items-center justify-center">
                <span className="font-mono text-[10px] text-[#FB631B] leading-none">&darr;</span>
              </div>
              <div className="rounded-[4px] border border-[#F9BC9F] bg-white px-3 py-2">
                <div className="font-mono uppercase text-[7px] tracking-[0.05em] text-[#FB631B] mb-1">Current value</div>
                <div className="text-[12px] text-[#1D1B16] font-medium leading-[16px] break-words">{fmtValue(data.update.to)}</div>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-[#5C5B59] leading-[17px]">
              This field changed in the most recent snapshot re-verification.
            </p>
          )}
        </div>
      )}

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-4 h-4 text-[#FB631B] animate-spin" />
            <span className="ml-2 font-mono text-[8px] uppercase tracking-[0.05em] text-[#ADADAC]">
              Loading basis...
            </span>
          </div>
        ) : (
          <>
            {/* Reasoning */}
            {reasoning && (
              <div className="px-6 py-4 border-b border-[#E5E5E5]">
                <div className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#ADADAC] mb-2">
                  Reasoning
                </div>
                <p className="text-[13px] text-[#5C5B59] leading-[20px]">
                  {reasoning}
                </p>
              </div>
            )}

            {/* Citations */}
            {uniqueCitations.length > 0 && (
              <div className="px-6 py-4">
                <div className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#ADADAC] mb-2">
                  Citations ({uniqueCitations.length})
                </div>
                <div className="space-y-2">
                  {uniqueCitations.map((cite, i) => (
                    <a
                      key={i}
                      href={cite.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 px-3 py-2.5 rounded-[4px] border border-[#E5E5E5] hover:border-[#FB631B] transition-colors group"
                    >
                      <span className="font-mono text-[8px] text-[#ADADAC] mt-0.5 shrink-0">
                        [{i + 1}]
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-[#1D1B16] leading-[16px] group-hover:text-[#FB631B] transition-colors">
                          {cite.title}
                        </div>
                        <div className="font-mono text-[8px] text-[#ADADAC] truncate mt-0.5">
                          {cite.url}
                        </div>
                      </div>
                      <ExternalLink className="w-3 h-3 text-[#ADADAC] group-hover:text-[#FB631B] shrink-0 mt-0.5" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-[#E5E5E5] shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-mono uppercase text-[8px] tracking-[0.05em] text-[#FB631B] bg-[#FCDDCF] px-1.5 py-0.5 rounded-[2px]">
            {data.source === "ai" ? "Classified by Task API" : data.update ? "Re-verified by Task API" : "Enriched by Task API"}
          </span>
          <button
            onClick={() => setShowCode(!showCode)}
            className="flex items-center gap-1 font-mono uppercase text-[8px] tracking-[0.05em] text-[#ADADAC] hover:text-[#1D1B16] transition-colors"
          >
            <Code className="w-2.5 h-2.5" />
            {showCode ? "Hide code" : "View code"}
          </button>
        </div>
        {showCode && (
          <div className="mt-2">
            {data.source === "ai" ? (
              <CopyCodeBlock
                label="POST /v1/tasks/runs"
                code={JSON.stringify({
                  input: `Classify AI datacenter: ${data.facilityName}`,
                  task_spec: {
                    output_schema: {
                      type: "json",
                      json_schema: {
                        type: "object",
                        properties: {
                          ai_class: { type: "string", enum: ["ai-training", "ai-inference", "ai-mixed", "cloud-hyperscale", "not-ai"] },
                          ai_evidence: { type: "string" },
                          water_impact: { type: "string", enum: ["high", "moderate", "low", "unknown"] },
                          water_note: { type: "string" },
                          grid_impact: { type: "string", enum: ["high", "moderate", "low", "unknown"] },
                          grid_note: { type: "string" },
                          community_pushback: { type: "string", enum: ["active-opposition", "some-concern", "none-found"] },
                          community_note: { type: "string" },
                        },
                        required: ["ai_class", "water_impact", "grid_impact", "community_pushback"],
                        additionalProperties: false,
                      },
                    },
                  },
                  processor: "ultra2x",
                }, null, 2)}
              />
            ) : (
              <CopyCodeBlock
                label="POST /v1/tasks/runs"
                code={JSON.stringify({
                  input: `Research facility: ${data.facilityName}`,
                  task_spec: {
                    output_schema: {
                      type: "json",
                      json_schema: {
                        type: "object",
                        properties: {
                          description: { type: "string" },
                          verified_status: { type: "string", enum: ["operational", "under-construction", "planned", "decommissioned"] },
                          power_capacity_mw: { type: "number" },
                          total_sqft: { type: "number" },
                          year_online: { type: "string" },
                          construction_update: { type: "string" },
                          recent_news: { type: "string" },
                          notable_tenants: { type: "string" },
                          verified_name: { type: "string" },
                          verified_operator: { type: "string" },
                          verified_owner: { type: "string" },
                          cooling_type: { type: "string" },
                          tier_level: { type: "string" },
                          fiber_providers: { type: "string" },
                          num_buildings: { type: "number" },
                          campus_acres: { type: "number" },
                          utility_provider: { type: "string" },
                          tax_incentives: { type: "string" },
                          natural_hazard_zone: { type: "string" },
                        },
                        required: ["description", "verified_status", "verified_name", "verified_operator"],
                        additionalProperties: false,
                      },
                    },
                  },
                  processor: "ultra2x",
                }, null, 2)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
