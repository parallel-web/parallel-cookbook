import type { RiskTier } from "../models/vendor.js";
import { normalizeSeverity } from "../models/risk-assessment.js";
import type {
  BasisCitation,
  BasisEntry,
  DeepResearchOutput,
  MonitorEventOutput,
  Recommendation,
  RiskAssessment,
  RiskDimensionOutput,
  SeverityCounts,
  TopCitation,
  VendorContext,
  VendorOverrides,
} from "../models/risk-assessment.js";

// ── Constants ──────────────────────────────────────────────────────────────

const RISK_ORDER: Record<RiskTier, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

const RECOMMENDATION_MAP: Record<RiskTier, Recommendation> = {
  LOW: "continue_monitoring",
  MEDIUM: "escalate_review",
  HIGH: "initiate_contingency",
  CRITICAL: "suspend_relationship",
};

// Confidence strings emitted by Parallel's processors. We coerce unknown
// values to 0 so they sort to the back of the queue.
const CONFIDENCE_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

// Map the dimension keys our flat schema uses to the prefix(es) the Task
// API will emit in `basis[].field`. The Task API names a field by its
// JSON Pointer-ish name (e.g. `cybersecurity.findings`), so a startsWith
// match groups all citations belonging to one dimension.
const DIMENSION_KEYS = [
  "financial_health",
  "legal_regulatory",
  "cybersecurity",
  "leadership_governance",
  "esg_reputation",
] as const;

// ── Risk Scorer ────────────────────────────────────────────────────────────

export class RiskScorer {
  scoreDeepResearch(
    output: DeepResearchOutput,
    vendorOverrides?: VendorOverrides,
    basis?: BasisEntry[],
  ): RiskAssessment {
    const dimensions: Record<string, RiskDimensionOutput> = {
      financial_health: output.financial_health,
      legal_regulatory: output.legal_regulatory,
      cybersecurity: output.cybersecurity,
      leadership_governance: output.leadership_governance,
      esg_reputation: output.esg_reputation,
    };

    // Step 1: Severity Aggregation
    const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const riskCategories: string[] = [];
    const mediumCategories: string[] = [];

    for (const [name, dim] of Object.entries(dimensions)) {
      const sev = normalizeSeverity(dim?.severity);
      if (sev === "CRITICAL") {
        counts.critical++;
        riskCategories.push(name);
      } else if (sev === "HIGH") {
        counts.high++;
        riskCategories.push(name);
      } else if (sev === "MEDIUM") {
        counts.medium++;
        mediumCategories.push(name);
      } else {
        counts.low++;
      }
    }

    // Step 2: Risk Level Assignment
    let riskLevel: RiskTier;
    let adverseFlag: boolean;

    if (counts.critical > 0) {
      riskLevel = "CRITICAL";
      adverseFlag = true;
    } else if (counts.high >= 2) {
      riskLevel = "HIGH";
      adverseFlag = true;
    } else if (counts.high === 1) {
      riskLevel = "HIGH";
      adverseFlag = true;
    } else if (counts.medium >= 3) {
      riskLevel = "MEDIUM";
      const uniqueMediumCats = new Set(mediumCategories);
      adverseFlag = uniqueMediumCats.size >= 2;
    } else if (counts.medium >= 1) {
      riskLevel = "MEDIUM";
      adverseFlag = false;
    } else {
      riskLevel = "LOW";
      adverseFlag = false;
    }

    if (counts.medium >= 3 && adverseFlag) {
      for (const cat of mediumCategories) {
        if (!riskCategories.includes(cat)) {
          riskCategories.push(cat);
        }
      }
    }

    // Step 3: Override Rules — applied to the dimension `status` strings
    // independent of severity. Cyber CRITICAL forces CRITICAL; legal
    // CRITICAL floors at HIGH.
    const triggeredOverrides: string[] = [];

    if (output.cybersecurity.status.toUpperCase() === "CRITICAL") {
      if (RISK_ORDER[riskLevel] < RISK_ORDER["CRITICAL"]) {
        riskLevel = "CRITICAL";
      }
      adverseFlag = true;
      triggeredOverrides.push("active_data_breach");
      if (!riskCategories.includes("cybersecurity")) {
        riskCategories.push("cybersecurity");
      }
    }

    if (output.legal_regulatory.status.toUpperCase() === "CRITICAL") {
      if (RISK_ORDER[riskLevel] < RISK_ORDER["HIGH"]) {
        riskLevel = "HIGH";
      }
      adverseFlag = true;
      triggeredOverrides.push("active_government_litigation");
      if (!riskCategories.includes("legal_regulatory")) {
        riskCategories.push("legal_regulatory");
      }
    }

    // Vendor risk_tier_override acts as a floor — never scores below.
    if (vendorOverrides?.risk_tier_override) {
      const override = vendorOverrides.risk_tier_override;
      if (RISK_ORDER[override] > RISK_ORDER[riskLevel]) {
        riskLevel = override;
        triggeredOverrides.push(`risk_tier_override_${override}`);
      }
    }

    // Step 4: Derive remaining fields
    const actionRequired = riskLevel === "HIGH" || riskLevel === "CRITICAL";
    const recommendation = RECOMMENDATION_MAP[riskLevel];
    const summary = this.buildSummary(
      output.vendor_name,
      riskLevel,
      adverseFlag,
      counts,
    );

    // Step 5: Basis plumbing — group Task API `output.basis` by dimension
    // and lift the top-confidence citation for each triggered dimension
    // into a flat `top_citations` array that Slack + the audit log can
    // consume without re-querying Parallel.
    const basisPerDimension = this.groupBasisByDimension(basis ?? []);
    const topCitations = this.pickTopCitations(
      basisPerDimension,
      riskCategories,
    );

    return {
      risk_level: riskLevel,
      adverse_flag: adverseFlag,
      risk_categories: riskCategories,
      summary,
      action_required: actionRequired,
      recommendation,
      severity_counts: counts,
      triggered_overrides: triggeredOverrides,
      ...(Object.keys(basisPerDimension).length > 0
        ? { basis_per_dimension: basisPerDimension }
        : {}),
      ...(topCitations.length > 0 ? { top_citations: topCitations } : {}),
    };
  }

  scoreMonitorEvent(
    event: MonitorEventOutput,
    vendorContext: VendorContext,
    basis?: BasisEntry[],
  ): RiskAssessment {
    // Off-enum / missing severity collapses to LOW so RECOMMENDATION_MAP
    // and SeverityCounts lookups are always defined (finding 11).
    const riskLevel = normalizeSeverity(event?.severity);
    const adverseFlag = !!event?.adverse;

    const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const key = riskLevel.toLowerCase() as keyof SeverityCounts;
    counts[key] = 1;

    const actionRequired = riskLevel === "HIGH" || riskLevel === "CRITICAL";
    const recommendation = RECOMMENDATION_MAP[riskLevel];
    const summary = `Monitor event for ${vendorContext.vendor_name}: ${event.event_summary}. Severity: ${riskLevel}.${adverseFlag ? " Adverse event flagged." : ""}`;

    // Monitor events emit basis under the top-level field name
    // ("event_summary", "severity", etc.) since the output schema is
    // flat. We pin them under a synthetic dimension matching event_type
    // so the audit log can still answer "which dimension fired".
    const flatBasis = this.flattenMonitorBasis(basis ?? [], event.event_type);
    const topCitations = this.pickTopCitations(flatBasis, [event.event_type]);

    return {
      risk_level: riskLevel,
      adverse_flag: adverseFlag,
      risk_categories: [event.event_type],
      summary,
      action_required: actionRequired,
      recommendation,
      severity_counts: counts,
      triggered_overrides: [],
      ...(Object.keys(flatBasis).length > 0
        ? { basis_per_dimension: flatBasis }
        : {}),
      ...(topCitations.length > 0 ? { top_citations: topCitations } : {}),
    };
  }

  // ── Basis Helpers ──────────────────────────────────────────────────────

  // Group Task API `output.basis` entries by the dimension key embedded
  // in `field`. Fields like `cybersecurity.findings` and
  // `cybersecurity.severity` both land under "cybersecurity".
  groupBasisByDimension(basis: BasisEntry[]): Record<string, BasisEntry[]> {
    const grouped: Record<string, BasisEntry[]> = {};
    for (const entry of basis) {
      const field = entry.field ?? "";
      // Match `dimension` or `dimension.<sub>`.
      const dimension =
        DIMENSION_KEYS.find(
          (d) => field === d || field.startsWith(`${d}.`),
        ) ?? null;
      if (!dimension) continue;
      (grouped[dimension] ??= []).push(entry);
    }
    return grouped;
  }

  // Monitor events are flat — basis fields are "event_summary" etc.
  // Bucket them under the event_type so they aren't lost.
  flattenMonitorBasis(
    basis: BasisEntry[],
    eventType: string,
  ): Record<string, BasisEntry[]> {
    if (basis.length === 0) return {};
    return { [eventType]: basis };
  }

  // For each triggered dimension, surface the single highest-confidence
  // citation. Falls back to the first citation when no confidence is
  // emitted by the processor. Caps the total list so Slack messages
  // don't get unwieldy.
  pickTopCitations(
    basisPerDimension: Record<string, BasisEntry[]>,
    triggeredDimensions: string[],
    maxPerDimension: number = 1,
    maxTotal: number = 3,
  ): TopCitation[] {
    const out: TopCitation[] = [];

    for (const dimension of triggeredDimensions) {
      const entries = basisPerDimension[dimension];
      if (!entries || entries.length === 0) continue;

      const sorted = [...entries].sort(
        (a, b) =>
          (CONFIDENCE_RANK[(b.confidence ?? "").toLowerCase()] ?? 0) -
          (CONFIDENCE_RANK[(a.confidence ?? "").toLowerCase()] ?? 0),
      );

      let added = 0;
      for (const entry of sorted) {
        if (added >= maxPerDimension) break;
        const citation: BasisCitation | undefined = entry.citations?.[0];
        if (!citation?.url) continue;
        out.push({
          dimension,
          url: citation.url,
          title: citation.title ?? undefined,
          reasoning: entry.reasoning ?? undefined,
          confidence: entry.confidence ?? undefined,
        });
        added++;
        if (out.length >= maxTotal) return out;
      }
    }

    return out;
  }

  private buildSummary(
    vendorName: string,
    riskLevel: RiskTier,
    adverseFlag: boolean,
    counts: SeverityCounts,
  ): string {
    const parts: string[] = [];
    parts.push(`${vendorName} assessed at ${riskLevel} risk level.`);

    const findings: string[] = [];
    if (counts.critical > 0) findings.push(`${counts.critical} critical`);
    if (counts.high > 0) findings.push(`${counts.high} high`);
    if (counts.medium > 0) findings.push(`${counts.medium} medium`);
    if (counts.low > 0) findings.push(`${counts.low} low`);
    parts.push(`Severity breakdown: ${findings.join(", ")} findings.`);

    if (adverseFlag) {
      parts.push("Adverse conditions detected requiring attention.");
    }

    return parts.join(" ");
  }
}
