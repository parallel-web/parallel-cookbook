import type { Vendor, RiskTier } from "../models/vendor.js";
import type { DeepResearchOutput, RiskAssessment } from "../models/risk-assessment.js";
import type {
  BatchResult,
  ProcessedResults,
  ResearchRunSummary,
} from "../models/research-run.js";
import type { ParallelTaskClient } from "./parallel-task-client.js";
import type { BatchPlanner, VendorBatch } from "./batch-planner.js";
import type { ResearchPromptBuilder } from "./research-prompt-builder.js";
import type { RiskScorer } from "./risk-scorer.js";
import type { SlackFormatter } from "./slack-formatter.js";
import type { SlackDeliveryService } from "./slack-delivery.js";
import type { AuditLogger } from "./audit-logger.js";
import type { SlackOpsReporter } from "./slack-ops-reporter.js";

// ── Options ────────────────────────────────────────────────────────────────

export interface ResearchOrchestratorOptions {
  taskClient: ParallelTaskClient;
  batchPlanner: BatchPlanner;
  promptBuilder: ResearchPromptBuilder;
  riskScorer: RiskScorer;
  formatter: SlackFormatter;
  deliveryService: SlackDeliveryService;
  auditLogger: AuditLogger;
  opsReporter?: SlackOpsReporter;
  cycleLength?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  logger?: Pick<Console, "debug" | "warn" | "error">;
}

// ── Orchestrator ───────────────────────────────────────────────────────────

export class ResearchOrchestrator {
  private readonly taskClient: ParallelTaskClient;
  private readonly batchPlanner: BatchPlanner;
  private readonly promptBuilder: ResearchPromptBuilder;
  private readonly riskScorer: RiskScorer;
  private readonly formatter: SlackFormatter;
  private readonly deliveryService: SlackDeliveryService;
  private readonly auditLogger: AuditLogger;
  private readonly opsReporter?: SlackOpsReporter;
  private readonly cycleLength: number;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly log: Pick<Console, "debug" | "warn" | "error">;

  constructor(options: ResearchOrchestratorOptions) {
    this.taskClient = options.taskClient;
    this.batchPlanner = options.batchPlanner;
    this.promptBuilder = options.promptBuilder;
    this.riskScorer = options.riskScorer;
    this.formatter = options.formatter;
    this.deliveryService = options.deliveryService;
    this.auditLogger = options.auditLogger;
    this.opsReporter = options.opsReporter;
    this.cycleLength = options.cycleLength ?? 7;
    this.pollIntervalMs = options.pollIntervalMs ?? 60_000;
    this.pollTimeoutMs = options.pollTimeoutMs ?? 3_600_000;
    this.log = options.logger ?? console;
  }

  // ── Top-Level Orchestration ────────────────────────────────────────────

  async runScheduledResearch(
    vendors: Vendor[],
  ): Promise<ResearchRunSummary> {
    const startTime = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    const dueVendors = this.batchPlanner.getVendorsDueForResearch(vendors, today);

    this.log.debug(
      "[orchestrator] %d vendors due for research out of %d total",
      dueVendors.length,
      vendors.length,
    );

    if (dueVendors.length === 0) {
      return this.buildSummary(0, 0, 0, {}, 0, 0, startTime);
    }

    const batches = this.batchPlanner.planBatches(dueVendors);

    // Execute all batches
    const allResults = new Map<string, DeepResearchOutput>();
    const allFailedDomains = new Set<string>();

    for (const batch of batches) {
      const batchResult = await this.executeBatch(batch);

      for (const [domain, output] of batchResult.results) {
        allResults.set(domain, output);
      }

      for (const failure of batchResult.failures) {
        allFailedDomains.add(failure.vendor_domain);
      }

      if (batchResult.failures.length > 0) {
        await this.handlePartialFailure(
          batch,
          batchResult.failures.map((f) => f.vendor_domain),
        );
      }
    }

    // Process results (score + route to Slack + audit)
    const processed = await this.processResults(allResults, dueVendors);

    // Advance dates only for successful vendors
    const succeededVendors = dueVendors.filter(
      (v) => allResults.has(v.vendor_domain) && !allFailedDomains.has(v.vendor_domain),
    );
    this.batchPlanner.updateNextResearchDates(succeededVendors, this.cycleLength);

    // Build summary
    const riskCounts: Record<RiskTier, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    let adverseCount = 0;
    for (const { assessment } of processed.assessments) {
      riskCounts[assessment.risk_level]++;
      if (assessment.adverse_flag) adverseCount++;
    }

    const summary = this.buildSummary(
      dueVendors.length,
      allResults.size,
      allFailedDomains.size,
      riskCounts,
      adverseCount,
      batches.length,
      startTime,
    );

    if (this.opsReporter && (summary.total_failed > 0 || summary.adverse_count > 0)) {
      try {
        await this.opsReporter.sendRunSummary(summary);
      } catch (err) {
        this.log.error("[orchestrator] Failed to send ops run summary: %s", (err as Error).message);
      }
    }

    return summary;
  }

  // ── Execute Single Batch ───────────────────────────────────────────────

  async executeBatch(batch: VendorBatch): Promise<BatchResult> {
    this.log.debug(
      "[orchestrator] Executing batch %d (%d vendors)",
      batch.batch_index,
      batch.vendors.length,
    );

    const taskGroup = await this.taskClient.createTaskGroup();
    const outputSchema = this.promptBuilder.getOutputSchema();

    const runs = batch.vendors.map((vendor) => ({
      input: this.promptBuilder.buildPrompt(vendor),
    }));

    const runIds = await this.taskClient.addRunsToGroup(
      taskGroup.taskgroup_id,
      runs,
      { output_schema: outputSchema },
    );

    // Map run_id → vendor_domain
    const runToVendor = new Map<string, string>();
    for (let i = 0; i < runIds.length; i++) {
      runToVendor.set(runIds[i], batch.vendors[i].vendor_domain);
    }

    // Poll until complete
    const groupResults = await this.taskClient.pollTaskGroupUntilComplete(
      taskGroup.taskgroup_id,
      this.pollIntervalMs,
      this.pollTimeoutMs,
    );

    // Map results back to vendor domains
    const results = new Map<string, DeepResearchOutput>();
    const failures: BatchResult["failures"] = [];

    for (const run of groupResults) {
      const vendorDomain = runToVendor.get(run.run_id);
      if (!vendorDomain) continue;

      if (run.status === "completed" && run.output) {
        results.set(vendorDomain, run.output.content as DeepResearchOutput);
      } else {
        failures.push({
          vendor_domain: vendorDomain,
          run_id: run.run_id,
          error: run.error ?? `Run ended with status: ${run.status}`,
        });
      }
    }

    return {
      batch_index: batch.batch_index,
      taskgroup_id: taskGroup.taskgroup_id,
      results,
      failures,
    };
  }

  // ── Process Results ────────────────────────────────────────────────────

  async processResults(
    results: Map<string, DeepResearchOutput>,
    vendors: Vendor[],
  ): Promise<ProcessedResults> {
    const vendorMap = new Map(vendors.map((v) => [v.vendor_domain, v]));
    const assessments: ProcessedResults["assessments"] = [];
    const errors: ProcessedResults["errors"] = [];

    for (const [domain, output] of results) {
      const vendor = vendorMap.get(domain);
      if (!vendor) {
        errors.push({ vendor_domain: domain, error: "Vendor not found in input list" });
        continue;
      }

      try {
        const assessment = this.riskScorer.scoreDeepResearch(output, {
          risk_tier_override: vendor.risk_tier_override,
        });

        // Route to Slack
        await this.routeToSlack(assessment, vendor, output);

        // Audit log
        await this.auditLogger.logAssessment({
          timestamp: new Date().toISOString(),
          vendor_name: vendor.vendor_name,
          risk_level: assessment.risk_level,
          adverse_flag: assessment.adverse_flag,
          categories: assessment.risk_categories.join(", "),
          summary: assessment.summary,
          run_id: "",
          source: "deep_research",
        });

        assessments.push({ vendor, assessment });
      } catch (err) {
        errors.push({
          vendor_domain: domain,
          error: `Processing failed: ${(err as Error).message}`,
        });
      }
    }

    return { assessments, errors };
  }

  // ── Handle Partial Failure ─────────────────────────────────────────────

  async handlePartialFailure(
    batch: VendorBatch,
    failedVendors: string[],
  ): Promise<void> {
    for (const domain of failedVendors) {
      this.log.warn(
        "[orchestrator] Vendor %s failed in batch %d — will retry next cycle",
        domain,
        batch.batch_index,
      );
    }
    // Failed vendors' next_research_date is NOT advanced
    // They will be picked up again in the next cycle
  }

  // ── Private Helpers ────────────────────────────────────────────────────

  private async routeToSlack(
    assessment: RiskAssessment,
    vendor: Vendor,
    output: DeepResearchOutput,
  ): Promise<void> {
    if (assessment.risk_level === "CRITICAL" || assessment.risk_level === "HIGH") {
      const message = this.formatter.formatCriticalAlert(
        assessment,
        vendor,
        output.adverse_events,
      );
      await this.deliveryService.sendAlert(message);
    } else if (assessment.risk_level === "MEDIUM") {
      this.deliveryService.queueForDigest(assessment, vendor);
    }
    // LOW → no immediate Slack alert
  }

  private buildSummary(
    totalDue: number,
    totalResearched: number,
    totalFailed: number,
    riskCounts: Partial<Record<RiskTier, number>>,
    adverseCount: number,
    batchesExecuted: number,
    startTime: number,
  ): ResearchRunSummary {
    return {
      total_due: totalDue,
      total_researched: totalResearched,
      total_failed: totalFailed,
      risk_counts: {
        LOW: riskCounts.LOW ?? 0,
        MEDIUM: riskCounts.MEDIUM ?? 0,
        HIGH: riskCounts.HIGH ?? 0,
        CRITICAL: riskCounts.CRITICAL ?? 0,
      },
      adverse_count: adverseCount,
      batches_executed: batchesExecuted,
      duration_ms: Date.now() - startTime,
    };
  }
}
