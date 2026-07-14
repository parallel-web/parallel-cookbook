import { describe, expect, it } from "vitest";

import {
  InvalidSnapshotEventError,
  reconstructSnapshotEvent,
} from "../src/snapshot-events.js";
import { basis, vendorReport } from "./fixtures.js";

describe("reconstructSnapshotEvent", () => {
  it("applies the live empty-previous payload to a complete fallback snapshot", () => {
    const previous = vendorReport();
    const financialHealth = {
      ...previous.financial_health,
      summary: "Liquidity weakened during the latest quarter.",
    };

    const reconstructed = reconstructSnapshotEvent(
      {
        event_id: "mevt_bb390d1f4512e6a4a54b0cecdce63bda8261f8d980f4139180f41391",
        event_group_id: "live-empty-previous",
        event_date: "2026-07-14",
        previous_output: { type: "json", content: {}, basis: [] },
        changed_output: {
          type: "json",
          content: { financial_health: financialHealth },
          basis: [basis("financial_health", "https://current.test/financial")],
        },
      },
      {
        report: previous,
        basis: [basis("financial_health", "https://old.test/financial")],
      },
    );

    expect(reconstructed.previousReport).toEqual(previous);
    expect(reconstructed.currentReport.financial_health).toEqual(financialHealth);
    expect(reconstructed.currentBasis).toEqual([
      basis("financial_health", "https://current.test/financial"),
    ]);
  });

  it("prefers a complete API predecessor over a supplied fallback", () => {
    const apiPrevious = vendorReport({ cybersecurity: "MEDIUM" });
    const fallback = vendorReport({ cybersecurity: "HIGH" });
    const reconstructed = reconstructSnapshotEvent(
      {
        event_id: "api-rebase",
        event_group_id: "group-api-rebase",
        event_date: "2026-07-14",
        previous_output: { type: "json", content: apiPrevious, basis: [] },
        changed_output: {
          type: "json",
          content: {
            financial_health: {
              ...apiPrevious.financial_health,
              summary: "API predecessor won.",
            },
          },
          basis: [],
        },
      },
      { report: fallback, basis: [basis("cybersecurity")] },
    );

    expect(reconstructed.previousReport.cybersecurity.severity).toBe("MEDIUM");
    expect(reconstructed.currentReport.cybersecurity.severity).toBe("MEDIUM");
  });

  it.each([
    ["unknown changed field", vendorReport(), { unknown_field: true }],
    ["non-empty malformed predecessor", { financial_health: {} }, {
      financial_health: vendorReport().financial_health,
    }],
  ])("rejects an %s even when a fallback exists", (_name, previousContent, changed) => {
    expect(() =>
      reconstructSnapshotEvent(
        {
          event_id: "strict-validation",
          event_group_id: "group-strict-validation",
          event_date: "2026-07-14",
          previous_output: { type: "json", content: previousContent, basis: [] },
          changed_output: { type: "json", content: changed, basis: [] },
        },
        { report: vendorReport(), basis: [] },
      ),
    ).toThrow(InvalidSnapshotEventError);
  });

  it("removes stale bracket-notation basis for every changed top-level field", () => {
    const previous = vendorReport(
      { cybersecurity: "HIGH" },
      [
        {
          category: "breach",
          severity: "HIGH",
          title: "Resolved incident",
          summary: "The incident was under investigation.",
        },
      ],
    );

    const reconstructed = reconstructSnapshotEvent({
      event_id: "resolved",
      event_group_id: "group-resolved",
      event_date: "2026-07-09",
      previous_output: {
        type: "json",
        content: previous,
        basis: [
          basis("cybersecurity[summary]", "https://old.test/security"),
          basis("adverse_events[0].summary", "https://old.test/incident"),
          basis("financial_health.summary", "https://current.test/financial"),
        ],
      },
      changed_output: {
        type: "json",
        content: {
          cybersecurity: {
            ...previous.cybersecurity,
            severity: "LOW",
            summary: "The incident was resolved.",
          },
          adverse_events: [],
        },
        basis: [],
      },
    });

    expect(reconstructed.currentBasis).toEqual([
      basis("financial_health.summary", "https://current.test/financial"),
    ]);
  });
});
