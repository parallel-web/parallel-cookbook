import axios from "axios";
import type { SlackMessage } from "../models/slack.js";
import type { SlackResponse } from "../models/slack-command.js";
import type { RiskAssessment } from "../models/risk-assessment.js";
import type { Vendor } from "../models/vendor.js";
import type { SlackFormatter } from "./slack-formatter.js";

// ── Options ────────────────────────────────────────────────────────────────

export interface SlackDeliveryServiceOptions {
  webhookUrl: string;
  formatter: SlackFormatter;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Digest Queue Entry ─────────────────────────────────────────────────────

interface DigestEntry {
  assessment: RiskAssessment;
  vendor: Vendor;
}

// ── Service ────────────────────────────────────────────────────────────────

export class SlackDeliveryService {
  private readonly webhookUrl: string;
  private readonly formatter: SlackFormatter;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  private digestQueue: DigestEntry[] = [];
  private sendQueue: Array<{
    fn: () => Promise<SlackResponse>;
    resolve: (value: SlackResponse) => void;
    reject: (err: unknown) => void;
  }> = [];
  private processing = false;

  constructor(options: SlackDeliveryServiceOptions) {
    this.webhookUrl = options.webhookUrl;
    this.formatter = options.formatter;
    this.log = options.logger ?? console;
  }

  // ── Send Methods ───────────────────────────────────────────────────────

  async sendAlert(message: SlackMessage): Promise<SlackResponse> {
    return this.enqueue(() => this.postToSlack(message));
  }

  async sendThreadReply(
    channel: string,
    threadTs: string,
    message: SlackMessage,
  ): Promise<SlackResponse> {
    return this.sendAlert({
      ...message,
      channel,
      thread_ts: threadTs,
    });
  }

  async sendAcknowledgment(
    channel: string,
    vendorName: string,
  ): Promise<string> {
    this.log.debug("[slack] Sending acknowledgment for %s", vendorName);

    const response = await this.sendAlert({
      channel,
      text: `Starting deep research on ${vendorName}. This typically takes 15-30 minutes...`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\ud83d\udd0d *Starting deep research on ${vendorName}*\nThis typically takes 15-30 minutes. Results will be posted in this thread.`,
          },
        },
      ],
    });

    return response.ts ?? "";
  }

  // ── Digest Queue ───────────────────────────────────────────────────────

  queueForDigest(assessment: RiskAssessment, vendor: Vendor): void {
    this.digestQueue.push({ assessment, vendor });
    this.log.debug(
      "[slack] Queued %s for digest (queue size: %d)",
      vendor.vendor_name,
      this.digestQueue.length,
    );
  }

  async flushDigest(): Promise<SlackResponse | null> {
    if (this.digestQueue.length === 0) {
      this.log.debug("[slack] Digest queue empty, nothing to flush");
      return null;
    }

    const assessments = this.digestQueue.map((e) => e.assessment);
    const today = new Date().toISOString().slice(0, 10);

    this.log.debug(
      "[slack] Flushing digest with %d assessments",
      assessments.length,
    );

    const message = this.formatter.formatDailyDigest(assessments, today);
    const response = await this.sendAlert(message);

    this.digestQueue = [];
    return response;
  }

  getDigestQueueSize(): number {
    return this.digestQueue.length;
  }

  // ── Private: Rate-Limited Queue ────────────────────────────────────────

  private enqueue(fn: () => Promise<SlackResponse>): Promise<SlackResponse> {
    return new Promise((resolve, reject) => {
      this.sendQueue.push({ fn, resolve, reject });
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.sendQueue.length > 0) {
      const item = this.sendQueue.shift()!;
      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }

      if (this.sendQueue.length > 0) {
        await this.sleep(1000);
      }
    }

    this.processing = false;
  }

  private async postToSlack(message: SlackMessage): Promise<SlackResponse> {
    this.log.debug("[slack] POST to %s channel=%s", this.webhookUrl, message.channel);

    const body: Record<string, unknown> = {
      channel: message.channel,
      text: message.text,
      blocks: message.blocks,
    };

    if (message.thread_ts) {
      body.thread_ts = message.thread_ts;
    }

    const response = await axios.post(this.webhookUrl, body);
    const data = response.data;

    if (typeof data === "string" && data === "ok") {
      return { ok: true };
    }

    return {
      ok: data?.ok ?? true,
      ts: data?.ts,
      error: data?.error,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
