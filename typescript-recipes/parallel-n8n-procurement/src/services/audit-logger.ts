import { appendFile, readFile } from "node:fs/promises";
import type { AuditLogEntry } from "../models/research-run.js";

// ── Audit Logger ───────────────────────────────────────────────────────────

export class AuditLogger {
  private readonly outputPath: string;

  constructor(outputPath: string = "audit-log.jsonl") {
    this.outputPath = outputPath;
  }

  async logAssessment(entry: AuditLogEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.outputPath, line);
  }

  async getHistory(
    vendorName: string,
    limit?: number,
  ): Promise<AuditLogEntry[]> {
    let content: string;
    try {
      content = await readFile(this.outputPath, "utf-8");
    } catch {
      return [];
    }

    const entries = content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as AuditLogEntry)
      .filter((entry) => entry.vendor_name === vendorName);

    if (limit !== undefined) {
      return entries.slice(-limit);
    }
    return entries;
  }
}
