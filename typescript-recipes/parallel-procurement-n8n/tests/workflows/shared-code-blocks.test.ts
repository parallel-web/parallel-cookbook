/**
 * Tests for the shared Code-node bodies in src/workflows/shared-code-blocks.ts.
 *
 * - Findings 18 + 20: workflow generators must use the shared constants so
 *   `runIdByDomain` doesn't drift back to `runIdToDomain`, and the 1h
 *   timeout path emits an ops_report listing in-flight runs.
 * - We assert on the source strings (not at runtime) — the code bodies
 *   ship as JS strings embedded in the workflow JSON.
 */
import { describe, it, expect } from "vitest";
import {
  RESEARCH_RUN_GROUP_CODE,
  RESEARCH_PARSE_RESULTS_CODE,
  RESEARCH_FILTER_CODE,
  SDK_CREATE_MONITOR_CODE,
  SDK_CANCEL_MONITOR_CODE,
  MONITOR_PARSE_WEBHOOK_CODE,
  MONITOR_FETCH_EVENT_CODE,
  buildMonitorQueryCode,
} from "@/workflows/shared-code-blocks.js";

describe("shared code blocks", () => {
  it("RESEARCH_RUN_GROUP_CODE uses the canonical runIdByDomain name", () => {
    expect(RESEARCH_RUN_GROUP_CODE).toContain("runIdByDomain");
    // The legacy `runIdToDomain` name caused drift between WF2 and the
    // combined workflow. Make sure no path re-introduces it.
    expect(RESEARCH_RUN_GROUP_CODE).not.toContain("runIdToDomain");
  });

  it("RESEARCH_RUN_GROUP_CODE emits an ops_report at the 1h cap (finding 18)", () => {
    expect(RESEARCH_RUN_GROUP_CODE).toContain("ops_report");
    expect(RESEARCH_RUN_GROUP_CODE).toContain("in_flight_count");
    expect(RESEARCH_RUN_GROUP_CODE).toContain("timed_out");
  });

  it("RESEARCH_PARSE_RESULTS_CODE reads from data.runIdByDomain", () => {
    expect(RESEARCH_PARSE_RESULTS_CODE).toContain("data.runIdByDomain");
    expect(RESEARCH_PARSE_RESULTS_CODE).toContain("runIdToDomain"); // local var name retained
  });

  it("RESEARCH_FILTER_CODE filters by next_research_date and active", () => {
    expect(RESEARCH_FILTER_CODE).toContain("next_research_date");
    expect(RESEARCH_FILTER_CODE).toContain("v.active");
  });

  it("SDK_CREATE_MONITOR_CODE / SDK_CANCEL_MONITOR_CODE call the V1 SDK", () => {
    expect(SDK_CREATE_MONITOR_CODE).toContain("client.monitor.create");
    expect(SDK_CANCEL_MONITOR_CODE).toContain("client.monitor.cancel");
  });

  it("MONITOR_PARSE_WEBHOOK_CODE pulls monitor_id + event_group_id", () => {
    expect(MONITOR_PARSE_WEBHOOK_CODE).toContain("payload.data.monitor_id");
    expect(MONITOR_PARSE_WEBHOOK_CODE).toContain("payload.data.event.event_group_id");
  });

  it("MONITOR_FETCH_EVENT_CODE calls client.monitor.events with event_group_id", () => {
    expect(MONITOR_FETCH_EVENT_CODE).toContain("client.monitor.events");
    expect(MONITOR_FETCH_EVENT_CODE).toContain("event_group_id");
  });

  describe("buildMonitorQueryCode", () => {
    it("interpolates the custom error message", () => {
      const code = buildMonitorQueryCode("my custom error", "/webhook/foo");
      expect(code).toContain('"my custom error"');
    });

    it("interpolates the webhook path", () => {
      const code = buildMonitorQueryCode("err", "/webhook/specific-path");
      expect(code).toContain('"/webhook/specific-path"');
    });

    it("uses escapeVendorName so embedded quotes don't unbalance the query", () => {
      const code = buildMonitorQueryCode("err", "/webhook/x");
      expect(code).toContain("escapeVendorName");
      expect(code).toContain('"' + "' + safeName + '" + '"');
    });
  });
});
