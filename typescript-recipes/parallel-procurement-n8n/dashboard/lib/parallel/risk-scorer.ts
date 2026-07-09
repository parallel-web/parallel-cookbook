import type {
  BasisCitation,
  BasisEntry,
  DeepResearchOutput,
  MonitorEventOutput,
  Recommendation,
  RiskAssessment,
  RiskDimensionOutput,
  RiskTier,
  SeverityCounts,
  TopCitation,
  VendorContext,
  VendorOverrides,
} from "./types";
import { normalizeSeverity } from "./severity";

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

const CONFIDENCE_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const DIMENSION_KEYS = [
  "financial_health",
  "legal_regulatory",
  "cybersecurity",
  "leadership_governance",
  "esg_reputation",
] as const;

// Backfill missing dimensions so a partial DeepResearchOutput (e.g. a
// run that completed with one of the five dimensions absent) doesn't
// trip a TypeError on `.severity` / `.status` access.
export function safeDim(
  dim: Partial<RiskDimensionOutput> | undefined | null,
): RiskDimensionOutput {
  return {
    status: dim?.status ?? "unknown",
    findings: dim?.findings ?? "",
    severity: normalizeSeverity(dim?.severity),
  };
}

export class RiskScorer {
  scoreDeepResearch(
    output: DeepResearchOutput,
    vendorOverrides?: VendorOverrides,
    basis?: BasisEntry[],
  ): RiskAssessment {
    // Defensive: a partial output (missing dimension) used to throw on
    // `dim.severity` access. safeDim() supplies a sensible default so the
    // scorer never explodes on schema drift.
    const dimensions: Record<string, RiskDimensionOutput> = {
      financial_health: safeDim(output.financial_health),
      legal_regulatory: safeDim(output.legal_regulatory),
      cybersecurity: safeDim(output.cybersecurity),
      leadership_governance: safeDim(output.leadership_governance),
      esg_reputation: safeDim(output.esg_reputation),
    };

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

    let riskLevel: RiskTier;
    let adverseFlag: boolean;

    if (counts.critical > 0) {
      riskLevel = "CRITICAL";
      adverseFlag = true;
    } else if (counts.high >= 1) {
      riskLevel = "HIGH";
      adverseFlag = true;
    } else if (counts.medium >= 3) {
      riskLevel = "MEDIUM";
      adverseFlag = new Set(mediumCategories).size >= 2;
    } else if (counts.medium >= 1) {
      riskLevel = "MEDIUM";
      adverseFlag = false;
    } else {
      riskLevel = "LOW";
      adverseFlag = false;
    }

    if (counts.medium >= 3 && adverseFlag) {
      for (const cat of mediumCategories) {
        if (!riskCategories.includes(cat)) riskCategories.push(cat);
      }
    }

    const triggeredOverrides: string[] = [];

    if ((output.cybersecurity?.status || "").toUpperCase() === "CRITICAL") {
      if (RISK_ORDER[riskLevel] < RISK_ORDER["CRITICAL"]) riskLevel = "CRITICAL";
      adverseFlag = true;
      triggeredOverrides.push("active_data_breach");
      if (!riskCategories.includes("cybersecurity")) riskCategories.push("cybersecurity");
    }

    if ((output.legal_regulatory?.status || "").toUpperCase() === "CRITICAL") {
      if (RISK_ORDER[riskLevel] < RISK_ORDER["HIGH"]) riskLevel = "HIGH";
      adverseFlag = true;
      triggeredOverrides.push("active_government_litigation");
      if (!riskCategories.includes("legal_regulatory")) riskCategories.push("legal_regulatory");
    }

    if (vendorOverrides?.risk_tier_override) {
      const override = vendorOverrides.risk_tier_override;
      if (RISK_ORDER[override] > RISK_ORDER[riskLevel]) {
        riskLevel = override;
        triggeredOverrides.push(`risk_tier_override_${override}`);
      }
    }

    const actionRequired = riskLevel === "HIGH" || riskLevel === "CRITICAL";
    const recommendation = RECOMMENDATION_MAP[riskLevel];
    const summary = this.buildSummary(output.vendor_name, riskLevel, adverseFlag, counts);

    // Basis plumbing — group Task API `output.basis` by dimension and
    // lift the top-confidence citation per triggered dimension into a
    // flat `top_citations` array consumed by Slack + the audit log.
    const basisPerDimension = this.groupBasisByDimension(basis ?? []);
    const topCitations = this.pickTopCitations(basisPerDimension, riskCategories);

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
    context: VendorContext,
    basis?: BasisEntry[],
  ): RiskAssessment {
    // Off-enum / missing severity collapses to LOW so RECOMMENDATION_MAP
    // and SeverityCounts lookups are always defined (matches the inline
    // normalizer the parallel-monitor webhook route uses).
    const riskLevel = normalizeSeverity(event?.severity);
    const eventType = event?.event_type || "unknown";
    const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    counts[riskLevel.toLowerCase() as keyof SeverityCounts] = 1;
    const recommendation = RECOMMENDATION_MAP[riskLevel];

    const flatBasis = basis && basis.length > 0 ? { [eventType]: basis } : {};
    const topCitations = this.pickTopCitations(flatBasis, [eventType]);

    const eventSummary = event?.event_summary ?? "";
    const adverse = !!event?.adverse;
    return {
      risk_level: riskLevel,
      adverse_flag: adverse,
      risk_categories: [eventType],
      summary: `Monitor event for ${context.vendor_name}: ${eventSummary}. Severity: ${riskLevel}.${adverse ? " Adverse event flagged." : ""}`,
      action_required: riskLevel === "HIGH" || riskLevel === "CRITICAL",
      recommendation,
      severity_counts: counts,
      triggered_overrides: [],
      ...(Object.keys(flatBasis).length > 0
        ? { basis_per_dimension: flatBasis }
        : {}),
      ...(topCitations.length > 0 ? { top_citations: topCitations } : {}),
    };
  }

  // ── Basis Helpers ────────────────────────────────────────────────────

  groupBasisByDimension(basis: BasisEntry[]): Record<string, BasisEntry[]> {
    const grouped: Record<string, BasisEntry[]> = {};
    for (const entry of basis) {
      const field = entry.field ?? "";
      const dimension =
        DIMENSION_KEYS.find((d) => field === d || field.startsWith(`${d}.`)) ??
        null;
      if (!dimension) continue;
      (grouped[dimension] ??= []).push(entry);
    }
    return grouped;
  }

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

  /**
   * Convert a RiskAssessment + raw research output to an integer score 0–100,
   * weighted heavily by critical/high counts. Used as the headline number on
   * the dashboard tiles.
   */
  scoreToNumber(assessment: RiskAssessment): number {
    const c = assessment.severity_counts;
    let raw = c.critical * 30 + c.high * 18 + c.medium * 8 + c.low * 1;
    if (assessment.triggered_overrides.includes("active_data_breach")) raw += 12;
    if (assessment.triggered_overrides.includes("active_government_litigation")) raw += 8;
    return Math.max(0, Math.min(100, raw));
  }

  private buildSummary(
    vendorName: string,
    riskLevel: RiskTier,
    adverseFlag: boolean,
    counts: SeverityCounts,
  ): string {
    const breakdown = [
      counts.critical > 0 && `${counts.critical} critical`,
      counts.high > 0 && `${counts.high} high`,
      counts.medium > 0 && `${counts.medium} medium`,
      counts.low > 0 && `${counts.low} low`,
    ]
      .filter(Boolean)
      .join(", ");

    return [
      `${vendorName} assessed at ${riskLevel} risk level.`,
      breakdown ? `Severity breakdown: ${breakdown} findings.` : "",
      adverseFlag ? "Adverse conditions detected requiring attention." : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
}
