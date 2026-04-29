import type { RiskTier } from "../models/vendor.js";
import type { Vendor } from "../models/vendor.js";
import type {
  RiskAssessment,
  AdverseEvent,
  MonitorEventOutput,
} from "../models/risk-assessment.js";
import type { SlackBlock, SlackMessage } from "../models/slack.js";

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_TEXT_LENGTH = 2000;

const EMOJI: Record<RiskTier, string> = {
  CRITICAL: "\ud83d\udd34",
  HIGH: "\ud83d\udfe0",
  MEDIUM: "\ud83d\udfe1",
  LOW: "\ud83d\udfe2",
};

const DEFAULT_CHANNELS = {
  critical: "#procurement-critical",
  alert: "#procurement-alerts",
  digest: "#procurement-digest",
};

// ── Options ────────────────────────────────────────────────────────────────

export interface SlackFormatterOptions {
  channels?: {
    critical?: string;
    alert?: string;
    digest?: string;
  };
}

// ── Formatter ──────────────────────────────────────────────────────────────

export class SlackFormatter {
  private readonly channels: { critical: string; alert: string; digest: string };

  constructor(options?: SlackFormatterOptions) {
    this.channels = {
      critical: options?.channels?.critical ?? DEFAULT_CHANNELS.critical,
      alert: options?.channels?.alert ?? DEFAULT_CHANNELS.alert,
      digest: options?.channels?.digest ?? DEFAULT_CHANNELS.digest,
    };
  }

  // ── Routing ──────────────────────────────────────────────────────────

  routeByRiskLevel(riskLevel: RiskTier): string {
    switch (riskLevel) {
      case "CRITICAL":
        return this.channels.critical;
      case "HIGH":
        return this.channels.alert;
      case "MEDIUM":
      case "LOW":
      default:
        return this.channels.digest;
    }
  }

  // ── Critical / High Alert ────────────────────────────────────────────

  formatCriticalAlert(
    assessment: RiskAssessment,
    vendor: Vendor,
    findings: AdverseEvent[],
  ): SlackMessage {
    const emoji = EMOJI[assessment.risk_level];
    const level = assessment.risk_level;
    const classification = assessment.adverse_flag ? "ADVERSE" : "MONITORING";
    const reviewHours = level === "CRITICAL" ? "24" : "48";

    const blocks: SlackBlock[] = [
      headerBlock(`${emoji} ${level} VENDOR RISK ALERT`),
      dividerBlock(),
      sectionBlock(
        `*Vendor:* ${vendor.vendor_name}\n*Risk Level:* ${level}\n*Classification:* ${classification}`,
      ),
      sectionBlock(truncate(assessment.summary, MAX_TEXT_LENGTH)),
    ];

    if (findings.length > 0) {
      const bullets = findings
        .map((f) => {
          const link = f.source_url ? ` (<${f.source_url}|source>)` : "";
          return `\u2022 *${f.title}* [${f.severity}] — ${f.description}${link}`;
        })
        .join("\n");
      blocks.push(sectionBlock(`*Key Findings:*\n${truncate(bullets, MAX_TEXT_LENGTH)}`));
    }

    if (assessment.risk_categories.length > 0) {
      blocks.push(
        sectionBlock(
          `*Risk Categories:* ${assessment.risk_categories.join(", ")}`,
        ),
      );
    }

    blocks.push(contextBlock(`Research date: ${new Date().toISOString()}`));
    blocks.push(dividerBlock());
    blocks.push(
      contextBlock(
        `Action Required: Review within ${reviewHours} hours`,
      ),
    );

    return {
      channel: this.routeByRiskLevel(assessment.risk_level),
      text: `${emoji} ${level} risk alert for ${vendor.vendor_name}: ${assessment.summary}`,
      blocks,
    };
  }

  // ── Daily Digest ─────────────────────────────────────────────────────

  formatDailyDigest(
    assessments: RiskAssessment[],
    date: string,
  ): SlackMessage {
    const adverseCount = assessments.filter((a) => a.adverse_flag).length;
    const lowCount = assessments.filter((a) => a.risk_level === "LOW").length;
    const mediumPlus = assessments.filter((a) => a.risk_level !== "LOW");

    const blocks: SlackBlock[] = [
      headerBlock(`\ud83d\udcca Daily Vendor Risk Digest \u2014 ${date}`),
      sectionBlock(
        `*Total Vendors Assessed:* ${assessments.length}\n*Adverse Findings:* ${adverseCount}`,
      ),
      dividerBlock(),
    ];

    if (mediumPlus.length > 0) {
      // Group by risk level
      for (const level of ["CRITICAL", "HIGH", "MEDIUM"] as RiskTier[]) {
        const group = mediumPlus.filter((a) => a.risk_level === level);
        if (group.length === 0) continue;

        const emoji = EMOJI[level];
        const lines = group
          .map(
            (a) =>
              `${emoji} *${a.risk_categories[0] ?? "vendor"}*: ${truncate(a.summary, 200)}`,
          )
          .join("\n");
        blocks.push(sectionBlock(lines));
      }
    }

    if (lowCount > 0) {
      blocks.push(
        contextBlock(
          `${EMOJI.LOW} ${lowCount} vendor${lowCount > 1 ? "s" : ""} assessed with no significant findings`,
        ),
      );
    }

    return {
      channel: this.channels.digest,
      text: `Daily vendor risk digest for ${date}: ${assessments.length} vendors assessed, ${adverseCount} adverse findings`,
      blocks,
    };
  }

  // ── Ad-Hoc Research Result ───────────────────────────────────────────

  formatAdHocResult(
    assessment: RiskAssessment,
    vendor: Vendor,
    requestedBy: string,
  ): SlackMessage {
    const emoji = EMOJI[assessment.risk_level];
    const counts = assessment.severity_counts;

    const blocks: SlackBlock[] = [
      headerBlock(`\ud83d\udd0d Ad-Hoc Research Result \u2014 ${vendor.vendor_name}`),
      sectionBlock(
        `*Requested by:* ${requestedBy}\n*Risk Level:* ${emoji} ${assessment.risk_level}\n*Recommendation:* ${assessment.recommendation}`,
      ),
      dividerBlock(),
      sectionBlock(truncate(assessment.summary, MAX_TEXT_LENGTH)),
      sectionBlock(
        `*Risk Categories:* ${assessment.risk_categories.length > 0 ? assessment.risk_categories.join(", ") : "None"}\n*Severity Breakdown:* ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low`,
      ),
    ];

    if (assessment.action_required) {
      blocks.push(
        sectionBlock(
          `\u26a0\ufe0f *Action Required:* This assessment requires immediate attention.`,
        ),
      );
    }

    blocks.push(contextBlock(`Completed: ${new Date().toISOString()}`));

    return {
      channel: this.routeByRiskLevel(assessment.risk_level),
      text: `Ad-hoc research for ${vendor.vendor_name} requested by ${requestedBy}: ${assessment.risk_level} risk`,
      blocks,
      thread_ts: "pending",
    };
  }

  // ── Monitor Alert ────────────────────────────────────────────────────

  formatMonitorAlert(
    assessment: RiskAssessment,
    vendor: Vendor,
    event: MonitorEventOutput,
  ): SlackMessage {
    const emoji = EMOJI[assessment.risk_level];

    const blocks: SlackBlock[] = [
      headerBlock(`${emoji} Monitor Alert \u2014 ${vendor.vendor_name}`),
      sectionBlock(
        `*Event Type:* ${event.event_type}\n*Severity:* ${event.severity}\n*Adverse:* ${event.adverse ? "Yes" : "No"}`,
      ),
      sectionBlock(truncate(event.event_summary, MAX_TEXT_LENGTH)),
      contextBlock(`Detected: ${new Date().toISOString()}`),
    ];

    return {
      channel: this.routeByRiskLevel(assessment.risk_level),
      text: `${emoji} Monitor alert for ${vendor.vendor_name}: ${event.event_summary}`,
      blocks,
    };
  }
}

// ── Block Kit Builders ─────────────────────────────────────────────────────

function headerBlock(text: string): SlackBlock {
  return {
    type: "header",
    text: { type: "plain_text", text, emoji: true },
  };
}

function dividerBlock(): SlackBlock {
  return { type: "divider" };
}

function sectionBlock(text: string): SlackBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
  };
}

function contextBlock(text: string): SlackBlock {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text }],
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
