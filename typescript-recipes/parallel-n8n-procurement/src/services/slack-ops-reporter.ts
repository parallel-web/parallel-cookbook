import type { HealthCheckReport } from "../models/health-check.js";
import type { ResearchRunSummary } from "../models/research-run.js";
import type { SlackDeliveryService } from "./slack-delivery.js";

// ── Options ────────────────────────────────────────────────────────────────

export interface SlackOpsReporterOptions {
  deliveryService: SlackDeliveryService;
  opsChannel?: string;
}

// ── Reporter ───────────────────────────────────────────────────────────────

export class SlackOpsReporter {
  private readonly deliveryService: SlackDeliveryService;
  private readonly opsChannel: string;

  constructor(options: SlackOpsReporterOptions) {
    this.deliveryService = options.deliveryService;
    this.opsChannel = options.opsChannel ?? "#vendor-risk-ops";
  }

  async sendHealthReport(report: HealthCheckReport): Promise<void> {
    const date = report.timestamp.slice(0, 10);
    const webhookStatus = report.webhook_healthy
      ? "\u2705 Reachable"
      : "\u274c UNREACHABLE";

    const statsText = [
      `*Total Monitors:* ${report.total_monitors}`,
      `*Active:* ${report.active_count} \u2705`,
      `*Failed:* ${report.failed_count} \u274c (re-created: ${report.monitors_recreated})`,
      `*Orphaned:* ${report.orphan_count} \ud83d\uddd1\ufe0f (deleted: ${report.orphans_deleted})`,
      `*Webhook Endpoint:* ${webhookStatus}`,
    ].join("\n");

    const blocks: Record<string, unknown>[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `\ud83d\udd27 Monitor Fleet Health Report \u2014 ${date}`,
          emoji: true,
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: statsText },
      },
    ];

    if (report.errors.length > 0) {
      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Errors (${report.errors.length}):*\n${report.errors.map((e) => `\u2022 ${e}`).join("\n")}`,
        },
      });
    }

    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Health check completed at ${report.timestamp}` }],
    });

    const fallback = `Monitor Fleet Health: ${report.total_monitors} total, ${report.active_count} active, ${report.failed_count} failed, ${report.orphan_count} orphaned`;

    await this.deliveryService.sendAlert({
      channel: this.opsChannel,
      text: fallback,
      blocks,
    });
  }

  async sendRunSummary(summary: ResearchRunSummary): Promise<void> {
    const date = new Date().toISOString().slice(0, 10);
    const hasFailed = summary.total_failed > 0;
    const hasAdverse = summary.adverse_count > 0;
    const icon = hasFailed ? "\u26a0\ufe0f" : "\u2705";

    const statsText = [
      `*Vendors Due:* ${summary.total_due}`,
      `*Researched:* ${summary.total_researched}`,
      `*Failed:* ${summary.total_failed}${hasFailed ? " \u274c" : ""}`,
      `*Adverse Findings:* ${summary.adverse_count}${hasAdverse ? " \u26a0\ufe0f" : ""}`,
      `*Batches:* ${summary.batches_executed}`,
      `*Duration:* ${(summary.duration_ms / 1000).toFixed(1)}s`,
    ].join("\n");

    const riskText = [
      `CRITICAL: ${summary.risk_counts.CRITICAL}`,
      `HIGH: ${summary.risk_counts.HIGH}`,
      `MEDIUM: ${summary.risk_counts.MEDIUM}`,
      `LOW: ${summary.risk_counts.LOW}`,
    ].join("  |  ");

    const blocks: Record<string, unknown>[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${icon} Research Run Complete \u2014 ${date}`,
          emoji: true,
        },
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: statsText },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `*Risk Breakdown:* ${riskText}` }],
      },
    ];

    const fallback = `Research Run Complete \u2014 ${date}: ${summary.total_researched}/${summary.total_due} vendors, ${summary.total_failed} failures, ${summary.adverse_count} adverse`;

    await this.deliveryService.sendAlert({
      channel: this.opsChannel,
      text: fallback,
      blocks,
    });
  }
}
