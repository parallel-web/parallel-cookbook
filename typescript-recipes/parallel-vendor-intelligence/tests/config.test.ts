import { describe, expect, it } from "vitest";

import {
  configFromEnv,
  createVendorIntelligenceFromEnv,
} from "../src/config.js";
import { MonitorFrequencySchema } from "../src/vendor-config.js";
import { fakeClient } from "./runtime.js";

describe("configuration", () => {
  it("uses the two documented teaching defaults", () => {
    expect(configFromEnv({})).toEqual({
      monitorFrequency: "1d",
      followUpRiskThreshold: "HIGH",
    });
  });

  it.each(["1h", "12h", "1d", "30d", "4w"])(
    "accepts an in-range Monitor frequency: %s",
    (frequency) => {
      expect(MonitorFrequencySchema.parse(frequency)).toBe(frequency);
    },
  );

  it.each(["0h", "31d", "5w", "daily", "1.5h"])(
    "rejects an invalid Monitor frequency: %s",
    (frequency) => {
      expect(() => MonitorFrequencySchema.parse(frequency)).toThrow();
    },
  );

  it("rejects an unknown follow-up threshold", () => {
    expect(() => configFromEnv({ FOLLOW_UP_RISK_THRESHOLD: "SEVERE" })).toThrow();
  });

  it("requires an API key when no test client is injected", () => {
    expect(() => createVendorIntelligenceFromEnv({})).toThrow("PARALLEL_API_KEY");
  });

  it("validates programmatic overrides after merging them with defaults", () => {
    expect(() =>
      createVendorIntelligenceFromEnv(
        {},
        {
          client: fakeClient().client,
          config: { taskResultMaxWaitMilliseconds: -1 },
        },
      ),
    ).toThrow();
  });

  it("lets a valid programmatic override replace an invalid environment value", () => {
    expect(() =>
      createVendorIntelligenceFromEnv(
        { MONITOR_FREQUENCY: "never" },
        {
          client: fakeClient().client,
          config: { monitorFrequency: "2d" },
        },
      ),
    ).not.toThrow();
  });
});
