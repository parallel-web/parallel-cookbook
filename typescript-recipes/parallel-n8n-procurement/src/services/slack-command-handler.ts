import type { Vendor } from "../models/vendor.js";
import type { DeepResearchOutput } from "../models/risk-assessment.js";
import type {
  SlackSlashCommandPayload,
  ParsedCommand,
  TaskWebhookPayload,
} from "../models/slack-command.js";
import type { SlackDeliveryService } from "./slack-delivery.js";
import type { ParallelTaskClient } from "./parallel-task-client.js";
import type { RiskScorer } from "./risk-scorer.js";
import type { ResearchPromptBuilder } from "./research-prompt-builder.js";
import type { SlackFormatter } from "./slack-formatter.js";

// ── Pending Request ────────────────────────────────────────────────────────

interface PendingRequest {
  run_id: string;
  channel_id: string;
  thread_ts: string;
  vendor: Vendor;
  requesting_user: string;
}

// ── Options ────────────────────────────────────────────────────────────────

export interface SlackCommandHandlerOptions {
  deliveryService: SlackDeliveryService;
  taskClient: ParallelTaskClient;
  riskScorer: RiskScorer;
  promptBuilder: ResearchPromptBuilder;
  formatter: SlackFormatter;
  vendorLookup: (name: string) => Vendor | undefined;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Handler ────────────────────────────────────────────────────────────────

export class SlackCommandHandler {
  private readonly deliveryService: SlackDeliveryService;
  private readonly taskClient: ParallelTaskClient;
  private readonly riskScorer: RiskScorer;
  private readonly promptBuilder: ResearchPromptBuilder;
  private readonly formatter: SlackFormatter;
  private readonly vendorLookup: (name: string) => Vendor | undefined;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;
  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(options: SlackCommandHandlerOptions) {
    this.deliveryService = options.deliveryService;
    this.taskClient = options.taskClient;
    this.riskScorer = options.riskScorer;
    this.promptBuilder = options.promptBuilder;
    this.formatter = options.formatter;
    this.vendorLookup = options.vendorLookup;
    this.log = options.logger ?? console;
  }

  // ── Parse ──────────────────────────────────────────────────────────────

  parseSlashCommand(payload: SlackSlashCommandPayload): ParsedCommand {
    const vendorName = payload.text.trim();

    if (!vendorName) {
      throw new Error(
        "Vendor name is required. Usage: /vendor-research {vendor_name}",
      );
    }

    return {
      vendor_name: vendorName,
      requesting_user: payload.user_name,
      channel_id: payload.channel_id,
      response_url: payload.response_url,
    };
  }

  // ── Handle Research Command ────────────────────────────────────────────

  async handleResearchCommand(command: ParsedCommand): Promise<void> {
    const vendor = this.vendorLookup(command.vendor_name);

    if (!vendor) {
      this.log.warn(
        "[command] Vendor not found: %s",
        command.vendor_name,
      );
      await this.deliveryService.sendAlert({
        channel: command.channel_id,
        text: `Vendor "${command.vendor_name}" not found. Please check the spelling and try again.`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `\u274c Vendor *"${command.vendor_name}"* not found in the vendor registry.\nPlease check the spelling and try again.`,
            },
          },
        ],
      });
      return;
    }

    this.log.debug(
      "[command] Starting ad-hoc research for %s requested by %s",
      vendor.vendor_name,
      command.requesting_user,
    );

    const threadTs = await this.deliveryService.sendAcknowledgment(
      command.channel_id,
      vendor.vendor_name,
    );

    const prompt = this.promptBuilder.buildPrompt(vendor);
    const outputSchema = this.promptBuilder.getOutputSchema();

    const taskRun = await this.taskClient.createRun({
      input: prompt,
      outputSchema,
    });

    this.pendingRequests.set(taskRun.run_id, {
      run_id: taskRun.run_id,
      channel_id: command.channel_id,
      thread_ts: threadTs,
      vendor,
      requesting_user: command.requesting_user,
    });

    this.log.debug(
      "[command] Task run %s created for %s",
      taskRun.run_id,
      vendor.vendor_name,
    );
  }

  // ── Handle Webhook Callback ────────────────────────────────────────────

  async handleWebhookCallback(payload: TaskWebhookPayload): Promise<void> {
    const pending = this.pendingRequests.get(payload.run_id);

    if (!pending) {
      this.log.warn(
        "[command] Received callback for unknown run_id: %s",
        payload.run_id,
      );
      return;
    }

    this.log.debug(
      "[command] Webhook callback for %s (vendor: %s)",
      payload.run_id,
      pending.vendor.vendor_name,
    );

    const result = await this.taskClient.getRunResult(payload.run_id);
    const researchOutput = result.output.content as DeepResearchOutput;

    const assessment = this.riskScorer.scoreDeepResearch(researchOutput);
    const message = this.formatter.formatAdHocResult(
      assessment,
      pending.vendor,
      pending.requesting_user,
    );

    await this.deliveryService.sendThreadReply(
      pending.channel_id,
      pending.thread_ts,
      message,
    );

    this.pendingRequests.delete(payload.run_id);
  }

  getPendingCount(): number {
    return this.pendingRequests.size;
  }
}
