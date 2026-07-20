import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal localStorage stub (vitest runs in node — no DOM needed for this lib).
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

import { agoLabel, getCached, recentQueries, saveCached } from "./cache";
import type { ResearchBrief } from "../types";

const brief = { query: "acme.ai", company_name: "Acme" } as ResearchBrief;

beforeEach(() => store.clear());

describe("session cache", () => {
  it("round-trips a brief keyed by query+depth", () => {
    saveCached("Acme.AI", "fast", brief);
    expect(getCached("acme.ai", "fast")?.brief.company_name).toBe("Acme");
    expect(getCached("acme.ai", "deep")).toBeNull(); // depth is part of the key
  });

  it("caps stored entries at 10, evicting oldest", () => {
    for (let i = 0; i < 14; i++) saveCached(`q${i}`, "fast", brief);
    expect(getCached("q0", "fast")).toBeNull();
    expect(getCached("q13", "fast")).not.toBeNull();
  });

  it("lists recent distinct queries, newest first", () => {
    saveCached("alpha", "fast", brief);
    saveCached("beta", "fast", brief);
    saveCached("alpha", "fast", brief); // re-run bumps, not duplicates
    const recents = recentQueries();
    expect(recents.map((r) => r.query)).toEqual(["alpha", "beta"]);
  });

  it("survives corrupted storage", () => {
    store.set("pse-brief-cache-v1", "{not json");
    expect(getCached("acme.ai", "fast")).toBeNull(); // no throw
  });
});

describe("agoLabel", () => {
  it("formats seconds/minutes/hours", () => {
    const now = Date.now();
    expect(agoLabel(now - 30_000)).toMatch(/s ago$/);
    expect(agoLabel(now - 5 * 60_000)).toMatch(/m ago$/);
    expect(agoLabel(now - 3 * 3_600_000)).toMatch(/h ago$/);
  });
});
