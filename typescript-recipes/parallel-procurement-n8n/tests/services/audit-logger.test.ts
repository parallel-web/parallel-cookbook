import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditLogger } from "@/services/audit-logger.js";
import type { AuditLogEntry } from "@/models/research-run.js";

// ── Mock fs ────────────────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
}));

import { appendFile, readFile } from "node:fs/promises";
const mockAppendFile = vi.mocked(appendFile);
const mockReadFile = vi.mocked(readFile);

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    timestamp: "2026-03-05T12:00:00.000Z",
    vendor_name: "Acme Corp",
    risk_level: "HIGH",
    adverse_flag: true,
    categories: "cybersecurity, legal_regulatory",
    summary: "Elevated risk due to breach.",
    run_id: "run_123",
    source: "deep_research",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFile.mockResolvedValue("");
});

// ── logAssessment ──────────────────────────────────────────────────────────

describe("logAssessment", () => {
  it("appends JSON line to file", async () => {
    const logger = new AuditLogger("/tmp/test-audit.jsonl");
    const entry = makeEntry();

    await logger.logAssessment(entry);

    expect(mockAppendFile).toHaveBeenCalledWith(
      "/tmp/test-audit.jsonl",
      expect.stringContaining("Acme Corp"),
    );
    const written = mockAppendFile.mock.calls[0][1] as string;
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written.trim())).toEqual(entry);
  });
});

// ── getHistory ─────────────────────────────────────────────────────────────

describe("getHistory", () => {
  it("returns entries for specific vendor", async () => {
    const logger = new AuditLogger("/tmp/test-audit.jsonl");
    const lines = [
      JSON.stringify(makeEntry({ vendor_name: "Acme Corp" })),
      JSON.stringify(makeEntry({ vendor_name: "Other Co" })),
      JSON.stringify(makeEntry({ vendor_name: "Acme Corp", risk_level: "LOW" })),
    ].join("\n");
    mockReadFile.mockResolvedValueOnce(lines);

    const history = await logger.getHistory("Acme Corp");

    expect(history).toHaveLength(2);
    expect(history[0].vendor_name).toBe("Acme Corp");
    expect(history[1].risk_level).toBe("LOW");
  });

  it("respects limit", async () => {
    const logger = new AuditLogger("/tmp/test-audit.jsonl");
    const lines = [
      JSON.stringify(makeEntry({ summary: "First" })),
      JSON.stringify(makeEntry({ summary: "Second" })),
      JSON.stringify(makeEntry({ summary: "Third" })),
    ].join("\n");
    mockReadFile.mockResolvedValueOnce(lines);

    const history = await logger.getHistory("Acme Corp", 2);

    expect(history).toHaveLength(2);
    expect(history[0].summary).toBe("Second");
    expect(history[1].summary).toBe("Third");
  });

  it("returns empty for nonexistent file", async () => {
    const logger = new AuditLogger("/tmp/nonexistent.jsonl");
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

    const history = await logger.getHistory("Acme Corp");

    expect(history).toEqual([]);
  });

  it("returns empty for vendor with no entries", async () => {
    const logger = new AuditLogger("/tmp/test-audit.jsonl");
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify(makeEntry({ vendor_name: "Other Co" })),
    );

    const history = await logger.getHistory("Acme Corp");

    expect(history).toEqual([]);
  });
});
