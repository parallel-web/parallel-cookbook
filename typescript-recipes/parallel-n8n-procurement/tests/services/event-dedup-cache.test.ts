import { describe, it, expect, vi, afterEach } from "vitest";
import { EventDedupCache } from "@/services/event-dedup-cache.js";
import type { EnrichedEvent } from "@/models/monitor-events.js";

function makeEvent(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
  return {
    event_group_id: "eg_1",
    monitor_id: "mon_1",
    vendor_name: "Acme Corp",
    vendor_domain: "https://acme.com",
    risk_dimension: "legal",
    monitoring_priority: "high",
    monitor_category: "Legal & Regulatory",
    event_summary: "Lawsuit filed",
    severity: "HIGH",
    adverse: true,
    event_type: "legal_regulatory",
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("EventDedupCache", () => {
  describe("generateKey", () => {
    it("produces correct format", () => {
      const cache = new EventDedupCache();
      const key = cache.generateKey(makeEvent());
      expect(key).toBe("https://acme.com:legal_regulatory:HIGH");
    });

    it("differs by event_type", () => {
      const cache = new EventDedupCache();
      const k1 = cache.generateKey(makeEvent({ event_type: "legal" }));
      const k2 = cache.generateKey(makeEvent({ event_type: "cyber" }));
      expect(k1).not.toBe(k2);
    });

    it("differs by severity", () => {
      const cache = new EventDedupCache();
      const k1 = cache.generateKey(makeEvent({ severity: "HIGH" }));
      const k2 = cache.generateKey(makeEvent({ severity: "CRITICAL" }));
      expect(k1).not.toBe(k2);
    });
  });

  describe("has", () => {
    it("returns false for nonexistent key", () => {
      const cache = new EventDedupCache();
      expect(cache.has("nonexistent")).toBe(false);
    });

    it("returns true within window", () => {
      vi.useFakeTimers();
      const cache = new EventDedupCache(60_000); // 1 minute

      cache.add("test-key");
      vi.advanceTimersByTime(30_000); // 30s

      expect(cache.has("test-key")).toBe(true);
    });

    it("returns false outside window", () => {
      vi.useFakeTimers();
      const cache = new EventDedupCache(60_000); // 1 minute

      cache.add("test-key");
      vi.advanceTimersByTime(120_000); // 2 minutes

      expect(cache.has("test-key")).toBe(false);
    });

    it("respects custom window parameter", () => {
      vi.useFakeTimers();
      const cache = new EventDedupCache(60_000);

      cache.add("test-key");
      vi.advanceTimersByTime(30_000);

      expect(cache.has("test-key", 10_000)).toBe(false); // 10s window
      expect(cache.has("test-key", 60_000)).toBe(true);  // 60s window
    });
  });

  describe("add", () => {
    it("adds key to cache", () => {
      const cache = new EventDedupCache();
      cache.add("key1");
      expect(cache.has("key1")).toBe(true);
      expect(cache.size).toBe(1);
    });

    it("overwrites existing key timestamp", () => {
      vi.useFakeTimers();
      const cache = new EventDedupCache(60_000);

      cache.add("key1");
      vi.advanceTimersByTime(50_000);
      cache.add("key1"); // refresh
      vi.advanceTimersByTime(30_000); // 80s from first add, 30s from refresh

      expect(cache.has("key1")).toBe(true); // still within window from refresh
    });
  });

  describe("cleanup", () => {
    it("removes expired entries", () => {
      vi.useFakeTimers();
      const cache = new EventDedupCache(60_000);

      cache.add("old");
      vi.advanceTimersByTime(120_000);
      cache.add("fresh");

      cache.cleanup();

      expect(cache.size).toBe(1);
      expect(cache.has("old")).toBe(false);
      expect(cache.has("fresh")).toBe(true);
    });

    it("keeps all entries when none expired", () => {
      const cache = new EventDedupCache(60_000);
      cache.add("a");
      cache.add("b");

      cache.cleanup();

      expect(cache.size).toBe(2);
    });

    it("respects custom maxAge", () => {
      vi.useFakeTimers();
      const cache = new EventDedupCache(60_000);

      cache.add("key1");
      vi.advanceTimersByTime(10_000);

      cache.cleanup(5_000); // 5s max age

      expect(cache.size).toBe(0);
    });
  });
});
