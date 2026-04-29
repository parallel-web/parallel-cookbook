import type { EnrichedEvent } from "../models/monitor-events.js";

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Deduplication Cache ────────────────────────────────────────────────────

export class EventDedupCache {
  private readonly cache = new Map<string, number>();
  private readonly defaultWindowMs: number;

  constructor(defaultWindowMs: number = DEFAULT_WINDOW_MS) {
    this.defaultWindowMs = defaultWindowMs;
  }

  generateKey(event: EnrichedEvent): string {
    return `${event.vendor_domain}:${event.event_type}:${event.severity}`;
  }

  has(key: string, windowMs?: number): boolean {
    const ts = this.cache.get(key);
    if (ts === undefined) return false;
    return Date.now() - ts < (windowMs ?? this.defaultWindowMs);
  }

  add(key: string): void {
    this.cache.set(key, Date.now());
  }

  cleanup(maxAgeMs?: number): void {
    const cutoff = Date.now() - (maxAgeMs ?? this.defaultWindowMs);
    for (const [key, ts] of this.cache) {
      if (ts < cutoff) {
        this.cache.delete(key);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }
}
