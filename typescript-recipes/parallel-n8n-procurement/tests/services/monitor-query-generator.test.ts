import { describe, it, expect } from "vitest";
import { MonitorQueryGenerator } from "@/services/monitor-query-generator.js";
import type { Vendor } from "@/models/vendor.js";

function makeVendor(
  overrides: Partial<Vendor> = {},
): Vendor {
  return {
    vendor_name: "Acme Corp",
    vendor_domain: "https://acme.com",
    vendor_category: "technology",
    monitoring_priority: "high",
    active: true,
    ...overrides,
  };
}

describe("MonitorQueryGenerator", () => {
  const generator = new MonitorQueryGenerator();

  describe("high priority", () => {
    it("returns 5 queries for all risk dimensions", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "high" }));
      expect(queries).toHaveLength(5);

      const dimensions = queries.map((q) => q.risk_dimension);
      expect(dimensions).toEqual(["legal", "cyber", "financial", "leadership", "esg"]);
    });

    it("all queries have daily cadence", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "high" }));
      for (const q of queries) {
        expect(q.cadence).toBe("daily");
      }
    });
  });

  describe("medium priority", () => {
    it("returns 3 queries for legal, cyber, financial", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "medium" }));
      expect(queries).toHaveLength(3);

      const dimensions = queries.map((q) => q.risk_dimension);
      expect(dimensions).toEqual(["legal", "cyber", "financial"]);
    });

    it("all queries have daily cadence", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "medium" }));
      for (const q of queries) {
        expect(q.cadence).toBe("daily");
      }
    });
  });

  describe("low priority", () => {
    it("returns 2 queries for legal and financial only", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "low" }));
      expect(queries).toHaveLength(2);

      const dimensions = queries.map((q) => q.risk_dimension);
      expect(dimensions).toEqual(["legal", "financial"]);
    });

    it("all queries have weekly cadence", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "low" }));
      for (const q of queries) {
        expect(q.cadence).toBe("weekly");
      }
    });
  });

  describe("vendor name interpolation", () => {
    it("interpolates vendor_name into each query", () => {
      const queries = generator.generateQueries(
        makeVendor({ vendor_name: "Tesla Inc", monitoring_priority: "low" }),
      );
      for (const q of queries) {
        expect(q.query).toContain('"Tesla Inc"');
        expect(q.query).not.toContain("{vendor_name}");
      }
    });

    it("handles vendor names with special characters", () => {
      const queries = generator.generateQueries(
        makeVendor({ vendor_name: "O'Reilly & Associates", monitoring_priority: "low" }),
      );
      expect(queries[0].query).toContain('"O\'Reilly & Associates"');
    });
  });

  describe("monitor categories", () => {
    it("assigns correct human-readable categories", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "high" }));
      const categories = queries.map((q) => q.monitor_category);
      expect(categories).toEqual([
        "Legal & Regulatory",
        "Cybersecurity",
        "Financial Health",
        "Leadership & Governance",
        "ESG & Reputation",
      ]);
    });
  });

  describe("query content", () => {
    it("legal query contains expected keywords", () => {
      const queries = generator.generateQueries(makeVendor());
      const legal = queries.find((q) => q.risk_dimension === "legal")!;
      expect(legal.query).toContain("lawsuit");
      expect(legal.query).toContain("litigation");
      expect(legal.query).toContain("SEC investigation");
    });

    it("cyber query contains expected keywords", () => {
      const queries = generator.generateQueries(makeVendor());
      const cyber = queries.find((q) => q.risk_dimension === "cyber")!;
      expect(cyber.query).toContain("data breach");
      expect(cyber.query).toContain("ransomware");
    });

    it("financial query contains expected keywords", () => {
      const queries = generator.generateQueries(makeVendor());
      const fin = queries.find((q) => q.risk_dimension === "financial")!;
      expect(fin.query).toContain("bankruptcy");
      expect(fin.query).toContain("credit downgrade");
    });

    it("leadership query contains expected keywords", () => {
      const queries = generator.generateQueries(makeVendor());
      const lead = queries.find((q) => q.risk_dimension === "leadership")!;
      expect(lead.query).toContain("CEO departure");
      expect(lead.query).toContain("merger");
    });

    it("esg query contains expected keywords", () => {
      const queries = generator.generateQueries(makeVendor());
      const esg = queries.find((q) => q.risk_dimension === "esg")!;
      expect(esg.query).toContain("environmental fine");
      expect(esg.query).toContain("ESG controversy");
    });
  });
});
