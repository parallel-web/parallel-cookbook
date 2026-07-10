import { describe, expect, it } from "vitest";

import { reconstructSnapshotEvent } from "../src/snapshot-events.js";
import { basis, vendorReport } from "./fixtures.js";

describe("reconstructSnapshotEvent", () => {
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
