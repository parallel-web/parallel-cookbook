import type { RiskTier } from "../models/vendor.js";
import type {
  DeepResearchOutput,
  MonitorEventOutput,
  VendorOverrides,
  VendorContext,
  SeverityCounts,
  Recommendation,
  RiskAssessment,
  RiskDimensionOutput,
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

const DIMENSION_NAMES: Record<string, string> = {
  financial_health: "financial_health",
  legal_regulatory: "legal_regulatory",
  cybersecurity: "cybersecurity",
  leadership_governance: "leadership_governance",
  esg_reputation: "esg_reputation",
};

// ── Risk Scorer ────────────────────────────────────────────────────────────

export class RiskScorer {
  scoreDeepResearch(
    output: DeepResearchOutput,
    vendorOverrides?: VendorOverrides,
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
      const sev = dim.severity.toUpperCase() as RiskTier;
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
      // Conditional: adverse if medium findings span ≥2 distinct categories
      const uniqueMediumCats = new Set(mediumCategories);
      adverseFlag = uniqueMediumCats.size >= 2;
    } else if (counts.medium >= 1) {
      riskLevel = "MEDIUM";
      adverseFlag = false;
    } else {
      riskLevel = "LOW";
      adverseFlag = false;
    }

    // Include medium categories in risk_categories for ≥3 medium with adverse
    if (counts.medium >= 3 && adverseFlag) {
      for (const cat of mediumCategories) {
        if (!riskCategories.includes(cat)) {
          riskCategories.push(cat);
        }
      }
    }

    // Step 3: Override Rules
    const triggeredOverrides: string[] = [];

    // Active data breach
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

    // Active government litigation
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

    // Vendor risk_tier_override as floor
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
    const summary = this.buildSummary(output.vendor_name, riskLevel, adverseFlag, counts);

    return {
      risk_level: riskLevel,
      adverse_flag: adverseFlag,
      risk_categories: riskCategories,
      summary,
      action_required: actionRequired,
      recommendation,
      severity_counts: counts,
      triggered_overrides: triggeredOverrides,
    };
  }

  scoreMonitorEvent(
    event: MonitorEventOutput,
    vendorContext: VendorContext,
  ): RiskAssessment {
    const riskLevel = event.severity.toUpperCase() as RiskTier;
    const adverseFlag = event.adverse;

    const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const key = riskLevel.toLowerCase() as keyof SeverityCounts;
    counts[key] = 1;

    const actionRequired = riskLevel === "HIGH" || riskLevel === "CRITICAL";
    const recommendation = RECOMMENDATION_MAP[riskLevel];
    const summary = `Monitor event for ${vendorContext.vendor_name}: ${event.event_summary}. Severity: ${riskLevel}.${adverseFlag ? " Adverse event flagged." : ""}`;

    return {
      risk_level: riskLevel,
      adverse_flag: adverseFlag,
      risk_categories: [event.event_type],
      summary,
      action_required: actionRequired,
      recommendation,
      severity_counts: counts,
      triggered_overrides: [],
    };
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
