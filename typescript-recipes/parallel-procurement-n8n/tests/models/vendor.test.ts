import { describe, it, expect } from "vitest";
import {
  VendorSchema,
  VendorRegistrySchema,
  VendorCategorySchema,
  RiskTierSchema,
  MonitoringPrioritySchema,
} from "@/models/vendor.js";

describe("VendorSchema", () => {
  const validVendor = {
    vendor_name: "Arcesium",
    vendor_domain: "https://arcesium.com",
    vendor_category: "technology",
    monitoring_priority: "high",
  };

  describe("valid vendors", () => {
    it("accepts a minimal valid vendor", () => {
      const result = VendorSchema.safeParse(validVendor);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.vendor_name).toBe("Arcesium");
        expect(result.data.active).toBe(true);
      }
    });

    it("accepts a fully populated vendor", () => {
      const full = {
        ...validVendor,
        risk_tier_override: "HIGH",
        active: false,
        next_research_date: "2026-04-01T00:00:00.000Z",
        monitor_ids: ["mon_abc123", "mon_def456"],
        last_synced_at: "2026-03-05T12:00:00.000Z",
      };
      const result = VendorSchema.safeParse(full);
      expect(result.success).toBe(true);
    });
  });

  describe("defaults", () => {
    it("applies active=true when not provided", () => {
      const result = VendorSchema.parse(validVendor);
      expect(result.active).toBe(true);
    });

    it("does not override explicit active=false", () => {
      const result = VendorSchema.parse({ ...validVendor, active: false });
      expect(result.active).toBe(false);
    });
  });

  describe("required field validation", () => {
    it("rejects missing vendor_name", () => {
      const { vendor_name, ...rest } = validVendor;
      const result = VendorSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects empty vendor_name", () => {
      const result = VendorSchema.safeParse({
        ...validVendor,
        vendor_name: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing vendor_domain", () => {
      const { vendor_domain, ...rest } = validVendor;
      const result = VendorSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing vendor_category", () => {
      const { vendor_category, ...rest } = validVendor;
      const result = VendorSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing monitoring_priority", () => {
      const { monitoring_priority, ...rest } = validVendor;
      const result = VendorSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });

  describe("enum validation", () => {
    it("rejects invalid vendor_category", () => {
      const result = VendorSchema.safeParse({
        ...validVendor,
        vendor_category: "invalid_category",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid risk_tier_override", () => {
      const result = VendorSchema.safeParse({
        ...validVendor,
        risk_tier_override: "EXTREME",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid monitoring_priority", () => {
      const result = VendorSchema.safeParse({
        ...validVendor,
        monitoring_priority: "urgent",
      });
      expect(result.success).toBe(false);
    });

    it("accepts all valid vendor categories", () => {
      const categories = [
        "technology",
        "financial_services",
        "manufacturing",
        "healthcare",
        "professional_services",
        "other",
      ];
      for (const cat of categories) {
        const result = VendorCategorySchema.safeParse(cat);
        expect(result.success).toBe(true);
      }
    });

    it("accepts all valid risk tiers", () => {
      for (const tier of ["LOW", "MEDIUM", "HIGH", "CRITICAL"]) {
        expect(RiskTierSchema.safeParse(tier).success).toBe(true);
      }
    });

    it("accepts all valid monitoring priorities", () => {
      for (const p of ["high", "medium", "low"]) {
        expect(MonitoringPrioritySchema.safeParse(p).success).toBe(true);
      }
    });
  });

  describe("format validation", () => {
    it("rejects non-URL vendor_domain", () => {
      const result = VendorSchema.safeParse({
        ...validVendor,
        vendor_domain: "not-a-url",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-ISO next_research_date", () => {
      const result = VendorSchema.safeParse({
        ...validVendor,
        next_research_date: "March 5, 2026",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-ISO last_synced_at", () => {
      const result = VendorSchema.safeParse({
        ...validVendor,
        last_synced_at: "yesterday",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("VendorRegistrySchema", () => {
  it("accepts a valid registry", () => {
    const registry = {
      vendors: [
        {
          vendor_name: "Bloomberg LP",
          vendor_domain: "https://bloomberg.com",
          vendor_category: "financial_services",
          monitoring_priority: "low",
        },
      ],
      total_count: 1,
    };
    const result = VendorRegistrySchema.safeParse(registry);
    expect(result.success).toBe(true);
  });

  it("accepts an empty registry", () => {
    const result = VendorRegistrySchema.safeParse({
      vendors: [],
      total_count: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a registry with last_sync_timestamp", () => {
    const result = VendorRegistrySchema.safeParse({
      vendors: [],
      total_count: 0,
      last_sync_timestamp: "2026-03-05T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative total_count", () => {
    const result = VendorRegistrySchema.safeParse({
      vendors: [],
      total_count: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer total_count", () => {
    const result = VendorRegistrySchema.safeParse({
      vendors: [],
      total_count: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
