import "dotenv/config";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Parallel from "parallel-web";
import { describe, expect, it } from "vitest";

import type { ParallelPort } from "../src/parallel-port.js";
import { createParallelPort } from "../src/parallel-sdk-adapter.js";
import { RECIPE_METADATA, SPEC_VERSION } from "../src/schema.js";
import { FileStateStore } from "../src/state.js";
import { DEFAULT_CONFIG } from "../src/vendor-config.js";
import { VendorIntelligence } from "../src/vendor-intelligence.js";

const liveTest = process.env.RUN_LIVE_TESTS === "1" ? it : it.skip;

describe("live production lifecycle", () => {
  liveTest(
    "bootstraps, checks, and confirms state-owned Monitor cancellation",
    async () => {
      const apiKey = process.env.PARALLEL_API_KEY;
      if (!apiKey) throw new Error("PARALLEL_API_KEY is required for the live test.");

      const directory = await mkdtemp(join(tmpdir(), "vendor-intelligence-live-"));
      const production = createParallelPort(new Parallel({ apiKey, timeout: 60_000 }));
      const monitorIds = new Set<string>();
      const client = {
        ...production,
        monitor: {
          ...production.monitor,
          async create(params, options) {
            const monitor = await production.monitor.create(params, options);
            monitorIds.add(monitor.monitor_id);
            return monitor;
          },
        },
      } satisfies ParallelPort;
      const store = new FileStateStore(directory);
      const service = new VendorIntelligence({
        client,
        store,
        config: { ...DEFAULT_CONFIG, monitorFrequency: "30d" },
      });

      try {
        const bootstrap = await service.bootstrap([
          { name: "Cloudflare", domain: "cloudflare.com" },
        ]);
        const monitorId = bootstrap.results[0]?.monitor.monitorId;
        if (monitorId) monitorIds.add(monitorId);
        expect(bootstrap.results).toHaveLength(1);
        expect(bootstrap.results[0]?.assessment.basis.length).toBeGreaterThan(0);
        expect(monitorId).toBeTruthy();

        const check = await service.checkForUpdates();
        expect(check.monitorsChecked).toBe(1);
        expect(check.errors).toEqual([]);
      } finally {
        try {
          const cleanup = await service.cleanup();
          for (const monitorId of monitorIds) {
            expect(cleanup.monitors).toContainEqual({
              vendor: "cloudflare.com",
              monitorId,
              status: "cancelled",
            });
          }
        } finally {
          const state = await store.read();
          const baseline = state.vendors["cloudflare.com"]?.baseline;
          if (baseline?.stage === "completed") {
            let cursor: string | undefined;
            const seenCursors = new Set<string>();
            do {
              const page = await client.monitor.list({
                limit: 100,
                status: ["active"],
                type: ["snapshot"],
                ...(cursor ? { cursor } : {}),
              });
              for (const monitor of page.monitors) {
                if (
                  monitor.type === "snapshot" &&
                  monitor.settings.task_run_id === baseline.run.runId &&
                  monitor.frequency === "30d" &&
                  monitor.processor === "lite" &&
                  monitor.metadata?.recipe === RECIPE_METADATA &&
                  monitor.metadata.vendor === "cloudflare.com" &&
                  monitor.metadata.spec === String(SPEC_VERSION)
                ) {
                  monitorIds.add(monitor.monitor_id);
                }
              }
              const next = page.next_cursor ?? undefined;
              if (next && seenCursors.has(next)) throw new Error("Repeated live-test cursor.");
              if (next) seenCursors.add(next);
              cursor = next;
            } while (cursor);
          }

          for (const monitorId of monitorIds) {
            let remote = await client.monitor.retrieve(monitorId);
            if (remote.status !== "cancelled") {
              await client.monitor.cancel(monitorId);
              remote = await client.monitor.retrieve(monitorId);
            }
            expect(remote.status).toBe("cancelled");
            console.error(`Confirmed cancelled Monitor ${monitorId}.`);
          }
          await rm(directory, { recursive: true, force: true });
        }
      }
    },
    20 * 60 * 1_000,
  );
});
