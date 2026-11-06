/**
 * The live pipeline, one company at a time, driven by webhooks.
 *
 * Every Task run's result comes back through `onRunComplete` (from the
 * webhook route, the hourly reconcile, or `drive` when running locally). It
 * stores the result, applies it to the company's manifest, then calls
 * `advance`, which works out the next step from the stored state alone:
 *
 *   sheet run      → evidence, fills, images, gate, publish   (sheet/make-sheet.ts)
 *   update run     → fills, gate, publish                     (updates/update.ts)
 *   then, once nothing is in flight for the company:
 *     1. a history run (trail@1) for every promise without one
 *     2. Extract fills, then a fact-check (check@2) for every outcome without a current one
 *     3. two more checks for an outcome a single check disputes; the majority stands
 *     4. a resolution run (resolve@1) for an outcome most checks dispute, then a fresh check
 *     5. publish a new version if anything changed
 *
 * Because each step is computed from stored state, a duplicate webhook, a
 * retry or a missed webhook picked up later all land in the same place.
 */
import type { SheetData } from "../lib/types";
import type { Parallel } from "../parallel/client";
import type { StoredRun } from "../parallel/task";
import { CHECK_SPEC_KEY, checkRequest } from "../sheet/check";
import { fillGaps } from "../sheet/fill";
import { completeSheet } from "../sheet/make-sheet";
import { recordProfile } from "../sheet/profile";
import { RESOLVE_SPEC_KEY, resolveRequest } from "../sheet/resolve";
import { appendFills, publish, readFills, readManifest, rebuild, sessionId, writeManifest, type Manifest } from "../sheet/stored";
import { TRAIL_SPEC_KEY, trailRequest } from "../sheet/trail";
import { companyFor, readInflight, readRaw, readSheet, withLock, writeDraft, writeInflight, writeRaw } from "../store";
import { ensureMonitor } from "../updates/monitors";
import { finishUpdate } from "../updates/update";
import { startRun } from "./runs";

type Log = (line: string) => void;

export type Step = { kind: "trail-run" | "check-run" | "resolve-run"; promise: string };

/** A step that failed this many times is not retried automatically. */
export const MAX_FAILURES = 2;

/**
 * What to run next for one company, from its manifest and rebuilt sheet.
 * Pure, so it can be tested and called as often as needed.
 */
export function planNext(manifest: Manifest, sheet: SheetData): Step[] {
  const ok = (kind: Step["kind"], pid: string) => (manifest.failures?.[`${kind}:${pid}`] ?? 0) < MAX_FAILURES;
  const step = (kind: Step["kind"]) => (pid: string): Step => ({ kind, promise: pid });
  const ids = sheet.promises.map((p) => p.id);

  // 1. A history for every promise that has none.
  const trails = ids.filter((pid) => !manifest.trails?.[pid] && ok("trail-run", pid));
  if (trails.length) return trails.map(step("trail-run"));

  // 2. A fact-check for every outcome without a current one (new, or changed by a later call).
  const fact = new Map(sheet.promises.map((p) => [p.id, p.factCheck ?? null]));
  const checks = ids.filter((pid) => manifest.trails?.[pid] && !fact.get(pid) && ok("check-run", pid));
  if (checks.length) return checks.map(step("check-run"));

  // 3. A single check that disputes the outcome: two more independent checks.
  const votes = ids.filter((pid) => {
    const f = fact.get(pid);
    return f && f.verdict !== "correct" && (f.checks ?? 1) <= 1 && !manifest.resolves?.[pid] && ok("check-run", pid);
  });
  if (votes.length) return votes.flatMap((pid) => [step("check-run")(pid), step("check-run")(pid)]);

  // 4. Most checks dispute it: one deeper run settles the outcome with sources. Once per promise.
  const resolves = ids.filter((pid) => fact.get(pid)?.verdict === "incorrect" && !manifest.resolves?.[pid] && ok("resolve-run", pid));
  return resolves.map(step("resolve-run"));
}

/** Two builds say the same thing to a reader. */
export function sameContent(a: SheetData, b: SheetData) {
  const strip = (s: SheetData) => JSON.stringify({ ...s, version: 0, builtAt: "" });
  return strip(a) === strip(b);
}

/**
 * The next step for one company: start runs, or publish what changed. Does
 * nothing while any of the company's runs is in flight. Call with its lock held.
 */
export async function advance(client: Parallel, ticker: string, log: Log): Promise<Step[]> {
  if (Object.keys(await readInflight(ticker)).length) return [];
  const manifest = await readManifest(ticker);
  if (!manifest) return [];
  const company = companyFor(ticker);
  let sheet = await rebuild(ticker, { manifest });
  const steps = planNext(manifest, sheet);

  if (steps.some((s) => s.kind === "check-run")) {
    // Quotes for statements the histories added, before the checks read them.
    const fills = await fillGaps(client, company, sheet, await readFills(ticker, [manifest.sheetRunId, ...manifest.updates.map((u) => u.runId)]), {
      sessionId: sessionId(ticker, manifest.sheetRunId),
      log,
    });
    await appendFills(ticker, manifest.sheetRunId, fills);
    if (fills.length) sheet = await rebuild(ticker, { manifest });
  }

  if (steps.length) {
    const checkRuns = async (pid: string) =>
      (await Promise.all([manifest.checks?.[pid] ?? []].flat().map((id) => readRaw<StoredRun>(ticker, "check-run", id)))).filter((r): r is StoredRun => !!r);
    for (const s of steps) {
      const request =
        s.kind === "trail-run"
          ? trailRequest(company, sheet, s.promise)
          : s.kind === "check-run"
            ? checkRequest(company, sheet, s.promise)
            : resolveRequest(company, sheet, s.promise, await checkRuns(s.promise));
      const spec = s.kind === "trail-run" ? TRAIL_SPEC_KEY : s.kind === "check-run" ? CHECK_SPEC_KEY : RESOLVE_SPEC_KEY;
      await startRun(client, ticker, s.kind, request, spec, { stage: { promise: s.promise, sheetRunId: manifest.sheetRunId } });
    }
    log(`${ticker}: started ${steps.map((s) => `${s.kind.replace("-run", "")} ${s.promise}`).join(", ")}`);
    return steps;
  }

  // Nothing left to run: publish if the sheet a reader would see has changed. Every change is a new version.
  const published = await readSheet(ticker);
  if (published && sameContent(published, sheet)) return [];
  const live = sheet.runs.filter(r => r.kind === "update").length;
  await writeManifest(ticker, { ...manifest, baseVersion: (published?.version ?? 0) - live });
  sheet = await rebuild(ticker);
  if (!sheet.gate.passed) {
    await writeDraft(sheet, `v${sheet.version}-quality`);
    log(`${ticker}: held v${sheet.version}; ${sheet.gate.checks.filter((c) => c.result === "fail").map((c) => c.label).join(", ")}`);
    return [];
  }
  await publish(sheet, { trigger: "rerun", callDate: null, monitorEventId: null });
  log(`${ticker}: published v${sheet.version}`);
  return [];
}

/** Applies a finished stage 2 or 3 run to the manifest. */
function applyStage(m: Manifest, kind: Step["kind"], pid: string, runId: string, ok: boolean): Manifest {
  if (!ok) return { ...m, failures: { ...m.failures, [`${kind}:${pid}`]: (m.failures?.[`${kind}:${pid}`] ?? 0) + 1 } };
  if (kind === "trail-run") {
    // A new history makes the old check stale.
    const checks = { ...m.checks };
    delete checks[pid];
    return { ...m, trails: { ...m.trails, [pid]: runId }, checks };
  }
  if (kind === "check-run") {
    const have = [m.checks?.[pid] ?? []].flat();
    return { ...m, checks: { ...m.checks, [pid]: have.includes(runId) ? have : [...have, runId] } };
  }
  // A resolution replaces the disputing checks (kept for provenance); a fresh check follows.
  const checks = { ...m.checks };
  const disputed = { ...m.disputed, [pid]: checks[pid] ?? [] };
  delete checks[pid];
  return { ...m, resolves: { ...m.resolves, [pid]: runId }, disputed, checks };
}

/**
 * A run finished. The webhook body is only a hint: the run is fetched from the
 * API, and handled only if this app started it and it is still in flight.
 */
export async function onRunComplete(client: Parallel, runId: string, log: Log): Promise<"handled" | "running" | "ignored"> {
  const run = await client.taskRun.retrieve(runId);
  const meta = (run.metadata ?? {}) as Record<string, unknown>;
  const ticker = typeof meta.ticker === "string" ? meta.ticker : "";
  if (meta.app !== "said-and-done" || !ticker) return "ignored";
  if (run.is_active) return "running";

  return withLock(ticker, async () => {
    const entry = (await readInflight(ticker))[runId];
    if (!entry) return "ignored";
    const result = run.status === "completed" ? await client.taskRun.result(runId) : null;
    const stored = (await readRaw<StoredRun>(ticker, entry.kind, runId)) ?? { run, input: {}, spec: entry.spec, result: null };
    const final: StoredRun = { ...stored, run: result?.run ?? run, result };
    await writeRaw(ticker, entry.kind, runId, final);
    log(`${ticker}: ${entry.kind.replace("-run", "")}${entry.promise ? ` ${entry.promise}` : ""} run ${runId} ${run.status}`);

    try {
      if (entry.kind === "sheet-run") {
        if (result) {
          const { published } = await completeSheet(client, companyFor(ticker), final, { trigger: "initial", log });
          if (published) await ensureMonitor(client, ticker, log);
        }
      } else if (entry.kind === "update-run") {
        await finishUpdate(client, ticker, runId, result, log);
      } else if (entry.kind === "profile-run") {
        await recordProfile(ticker, final);
      } else if (entry.promise) {
        const m = await readManifest(ticker);
        if (m && m.sheetRunId === entry.sheetRunId) {
          await writeManifest(ticker, applyStage(m, entry.kind, entry.promise, runId, !!result));
        } else {
          log(`${ticker}: skipped ${runId}; it is not linked to the current register`);
        }
      }
    } catch (error) {
      // Left in flight so the next reconcile retries it, up to three times.
      const inflight = await readInflight(ticker);
      const attempts = (inflight[runId]?.attempts ?? 0) + 1;
      if (attempts >= 3) delete inflight[runId];
      else inflight[runId] = { ...entry, attempts };
      await writeInflight(ticker, inflight);
      log(`${ticker}: handling ${runId} failed (attempt ${attempts}): ${(error as Error).message}`);
      throw error;
    }

    // Handled: no longer in flight. Then the next step, once nothing else is.
    const inflight = await readInflight(ticker);
    delete inflight[runId];
    await writeInflight(ticker, inflight);
    await advance(client, ticker, log);
    return "handled";
  });
}
