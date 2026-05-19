import { describe, it, expect } from "vitest";
import { MonitorQueryGenerator } from "@/services/monitor-query-generator.js";
import { escapeMonitorQueryVendorName } from "@/workflows/generator-utils.js";
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

    it("all queries have V1 frequency 1d", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "high" }));
      for (const q of queries) {
        expect(q.frequency).toBe("1d");
      }
    });

    it("cyber and legal get the base processor; the rest stay on lite", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "high" }));
      const byDim = new Map(queries.map((q) => [q.risk_dimension, q.processor]));
      expect(byDim.get("cyber")).toBe("base");
      expect(byDim.get("legal")).toBe("base");
      expect(byDim.get("financial")).toBe("lite");
      expect(byDim.get("leadership")).toBe("lite");
      expect(byDim.get("esg")).toBe("lite");
    });
  });

  describe("medium priority", () => {
    it("returns 3 queries for legal, cyber, financial", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "medium" }));
      expect(queries).toHaveLength(3);

      const dimensions = queries.map((q) => q.risk_dimension);
      expect(dimensions).toEqual(["legal", "cyber", "financial"]);
    });

    it("all queries have V1 frequency 1d", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "medium" }));
      for (const q of queries) {
        expect(q.frequency).toBe("1d");
      }
    });

    it("all queries use the lite processor (no base for non-high)", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "medium" }));
      for (const q of queries) {
        expect(q.processor).toBe("lite");
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

    it("all queries have V1 frequency 7d", () => {
      const queries = generator.generateQueries(makeVendor({ monitoring_priority: "low" }));
      for (const q of queries) {
        expect(q.frequency).toBe("7d");
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

  // ── Vendor name quote escaping (finding 15) ───────────────────────────
  describe("vendor name escaping", () => {
    it("strips embedded double-quotes so the wrapping pair stays balanced", () => {
      const queries = generator.generateQueries(makeVendor({ vendor_name: 'Acme "AI" Inc' }));
      for (const q of queries) {
        // Exactly two double-quotes per query — the wrapping pair around
        // the vendor name. Anything embedded gets collapsed to '.
        const quoteCount = (q.query.match(/"/g) ?? []).length;
        expect(quoteCount).toBe(2);
        expect(q.query).toContain("'AI'");
      }
    });

    it("collapses whitespace runs in the vendor name", () => {
      const queries = generator.generateQueries(makeVendor({ vendor_name: "  Acme   Corp  " }));
      for (const q of queries) {
        expect(q.query).toContain('"Acme Corp"');
      }
    });
  });
});

describe("escapeMonitorQueryVendorName", () => {
  it("strips embedded double-quotes", () => {
    expect(escapeMonitorQueryVendorName('Acme "AI" Inc')).toBe("Acme 'AI' Inc");
  });
  it("collapses whitespace", () => {
    expect(escapeMonitorQueryVendorName("  Foo  \t Bar  ")).toBe("Foo Bar");
  });
  it("returns empty string for falsy input", () => {
    expect(escapeMonitorQueryVendorName("")).toBe("");
    expect(escapeMonitorQueryVendorName(undefined as unknown as string)).toBe("");
    expect(escapeMonitorQueryVendorName(null as unknown as string)).toBe("");
  });
});
