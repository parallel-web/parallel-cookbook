import { describe, it, expect } from "vitest";
import {
  RiskDimensionSchema,
  MonitorQuerySetSchema,
  MonitorRegistryEntrySchema,
  ReconcileResultSchema,
} from "@/models/monitor-query.js";

describe("RiskDimensionSchema", () => {
  it("accepts all valid dimensions", () => {
    for (const d of ["legal", "cyber", "financial", "leadership", "esg"]) {
      expect(RiskDimensionSchema.safeParse(d).success).toBe(true);
    }
  });

  it("rejects invalid dimension", () => {
    expect(RiskDimensionSchema.safeParse("political").success).toBe(false);
  });
});

describe("MonitorQuerySetSchema", () => {
  it("accepts a valid query set", () => {
    const result = MonitorQuerySetSchema.safeParse({
      query: '"Acme" lawsuit OR litigation',
      risk_dimension: "legal",
      cadence: "daily",
      monitor_category: "Legal & Regulatory",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing query", () => {
    expect(
      MonitorQuerySetSchema.safeParse({
        risk_dimension: "legal",
        cadence: "daily",
        monitor_category: "Legal",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid risk_dimension", () => {
    expect(
      MonitorQuerySetSchema.safeParse({
        query: "test",
        risk_dimension: "unknown",
        cadence: "daily",
        monitor_category: "Test",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid cadence", () => {
    expect(
      MonitorQuerySetSchema.safeParse({
        query: "test",
        risk_dimension: "legal",
        cadence: "hourly",
        monitor_category: "Test",
      }).success,
    ).toBe(false);
  });
});

describe("MonitorRegistryEntrySchema", () => {
  it("accepts a valid entry", () => {
    const result = MonitorRegistryEntrySchema.safeParse({
      monitor_id: "mon_123",
      vendor_domain: "https://acme.com",
      risk_dimension: "cyber",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing monitor_id", () => {
    expect(
      MonitorRegistryEntrySchema.safeParse({
        vendor_domain: "https://acme.com",
        risk_dimension: "cyber",
      }).success,
    ).toBe(false);
  });
});

describe("ReconcileResultSchema", () => {
  it("accepts a valid reconcile result", () => {
    const result = ReconcileResultSchema.safeParse({
      to_create: [
        {
          vendor: {
            vendor_name: "Acme",
            vendor_domain: "https://acme.com",
            vendor_category: "technology",
            monitoring_priority: "high",
          },
          queries: [
            {
              query: '"Acme" lawsuit',
              risk_dimension: "legal",
              cadence: "daily",
              monitor_category: "Legal & Regulatory",
            },
          ],
        },
      ],
      to_delete: [
        { vendor_domain: "https://old.com", monitor_ids: ["mon_1", "mon_2"] },
      ],
      unchanged: [{ vendor_domain: "https://stable.com" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty arrays", () => {
    const result = ReconcileResultSchema.safeParse({
      to_create: [],
      to_delete: [],
      unchanged: [],
    });
    expect(result.success).toBe(true);
  });
});
