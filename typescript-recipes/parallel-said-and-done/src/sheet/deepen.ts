/**
 * Stages 2 and 3 for published sheets: a history run per promise, Extract fills
 * for its quotes, an independent fact-check per promise, then the gate.
 *
 *   pnpm deepen                     every company
 *   pnpm deepen MSFT GM             some companies
 *   pnpm deepen --only GM:P1,TJX:P2 --dry   chosen promises, drafts only
 */
import type { Company, SheetData } from "../lib/types";
import type { Parallel } from "../parallel/client";
import { awaitGroup, groupResults, startGroup, type StoredRun, type TaskRunResult } from "../parallel/task";
import { companyFor, readRaw, readSheet, writeDraft, writeRaw } from "../store";
import { CHECK_SPEC_KEY, checkRequest } from "./check";
import { fillGaps } from "./fill";
import { appendFills, publish, readFills, readManifest, rebuild, sessionId, writeManifest } from "./stored";
import { RESOLVE_SPEC_KEY, resolveRequest } from "./resolve";
import { TRAIL_SPEC_KEY, trailRequest } from "./trail";

type Log = (line: string) => void;
type Target = { company: Company; pid: string };

/** Runs one Task Group of per-promise requests and stores each finished run under its company. */
async function runStage(
  client: Parallel,
  targets: Target[],
  build: (t: Target) => ReturnType<typeof trailRequest> | ReturnType<typeof checkRequest> | ReturnType<typeof resolveRequest>,
  kind: "trail-run" | "check-run" | "resolve-run",
  spec: string,
  log: Log,
) {
  const requests = targets.map(build);
  const { groupId, runIds } = await startGroup(client, requests as never, { app: "said-and-done", spec });
  log(`${spec}: group ${groupId}, ${runIds.length} of ${requests.length} runs accepted`);
  await awaitGroup(client, groupId, log);
  const done = new Map<string, string>();
  for (const event of await groupResults(client, groupId)) {
    const meta = (event.run.metadata ?? {}) as Record<string, string>;
    const request = requests.find((r) => r.metadata.ticker === meta.ticker && r.metadata.promise === meta.promise);
    if (!request) continue;
    const stored: StoredRun = {
      run: event.run,
      input: request.input as Record<string, unknown>,
      spec,
      result: event.output ? ({ run: event.run, output: event.output } as TaskRunResult) : null,
    };
    writeRaw(meta.ticker, kind, event.run.run_id, stored);
    if (event.run.status === "completed") done.set(`${meta.ticker}:${meta.promise}`, event.run.run_id);
    else log(`${meta.ticker} ${meta.promise}: ${spec} run ${event.run.status}`);
  }
  return done;
}

export async function deepen(
  client: Parallel,
  tickers: string[],
  options: { only?: string[]; dry?: boolean; force?: boolean; checksOnly?: boolean; vote?: boolean; asOf: string; log: Log },
) {
  const { log } = options;
  const targets: Target[] = [];
  for (const t of tickers) {
    const sheet = readSheet(t);
    if (!sheet) continue;
    const m = readManifest(t);
    for (const p of sheet.promises) {
      if (options.only && !options.only.includes(`${t}:${p.id}`)) continue;
      // Already deepened (history and check on file) unless forced. A checks-only pass needs a history;
      // a vote takes the promises whose single check disputes the outcome.
      if (options.vote) {
        const draft = rebuild(t).promises.find((x) => x.id === p.id);
        if (!draft?.factCheck || draft.factCheck.verdict === "correct" || (draft.factCheck.checks ?? 1) > 1) continue;
      } else if (options.checksOnly ? !m?.trails?.[p.id] : !options.force && m?.trails?.[p.id] && m?.checks?.[p.id]) continue;
      targets.push({ company: companyFor(t), pid: p.id });
    }
  }
  const companies = [...new Set(targets.map((x) => x.company.ticker))];
  log(`deepen: ${targets.length} promises across ${companies.length} companies`);
  if (!targets.length) return [];

  // Stage 2: history runs. Each new history clears that promise's old check. A checks-only pass keeps the histories.
  const sheets = new Map(companies.map((t) => [t, readSheet(t)!] as [string, SheetData]));
  const trails = options.checksOnly || options.vote
    ? new Map(targets.map((x) => [`${x.company.ticker}:${x.pid}`, readManifest(x.company.ticker)!.trails![x.pid]]))
    : await runStage(client, targets, (x) => trailRequest(x.company, sheets.get(x.company.ticker)!, x.pid, options.asOf), "trail-run", TRAIL_SPEC_KEY, log);
  for (const t of options.checksOnly || options.vote ? [] : companies) {
    const m = readManifest(t)!;
    const mine = [...trails].filter(([k]) => k.startsWith(`${t}:`));
    const nextTrails = { ...(m.trails ?? {}) };
    const nextChecks = { ...(m.checks ?? {}) };
    for (const [k, runId] of mine) {
      const pid = k.split(":")[1];
      nextTrails[pid] = runId;
      delete nextChecks[pid];
    }
    writeManifest(t, { ...m, trails: nextTrails, checks: nextChecks, baseVersion: m.baseVersion ?? 0 });
  }

  // Extract fills for quotes the history runs' citations could not back.
  for (const t of options.checksOnly || options.vote ? [] : companies) {
    const m = readManifest(t)!;
    const sheet = rebuild(t);
    const fills = await fillGaps(client, companyFor(t), sheet, readFills(t, [m.sheetRunId]), { sessionId: sessionId(t, m.sheetRunId), log });
    appendFills(t, m.sheetRunId, fills);
  }

  // Stage 3: fact-check each promise as it would now be published.
  const built = new Map(companies.map((t) => [t, rebuild(t)] as [string, SheetData]));
  const checked = targets.filter((x) => trails.has(`${x.company.ticker}:${x.pid}`));
  // A vote adds two more independent checks to each disputed promise; the outcome goes by majority.
  const rounds = options.vote ? 2 : 1;
  const added = new Map<string, string[]>();
  for (let r = 0; r < rounds; r += 1) {
    const checks = await runStage(client, checked, (x) => checkRequest(x.company, built.get(x.company.ticker)!, x.pid), "check-run", CHECK_SPEC_KEY, log);
    for (const [k, runId] of checks) added.set(k, [...(added.get(k) ?? []), runId]);
  }
  for (const t of companies) {
    const m = readManifest(t)!;
    const nextChecks = { ...(m.checks ?? {}) };
    for (const [k, runIds] of added) {
      if (!k.startsWith(`${t}:`)) continue;
      const pid = k.split(":")[1];
      nextChecks[pid] = options.vote ? [...[nextChecks[pid] ?? []].flat(), ...runIds] : runIds[0];
    }
    writeManifest(t, { ...m, checks: nextChecks });
  }

  // Gate and publish: a deepened sheet is a new version.
  const out: { ticker: string; published: boolean; version: number }[] = [];
  for (const t of companies) {
    const current = readSheet(t)!;
    const m = readManifest(t)!;
    // New histories make a new version; a checks-only pass updates the version it checked.
    if (!options.dry && !options.checksOnly && !options.vote) writeManifest(t, { ...m, baseVersion: current.version - m.updates.filter((u) => u.status !== "held").length });
    const sheet = rebuild(t);
    for (const c of sheet.gate.checks) log(`  ${t} ${c.result.padEnd(4)} ${c.label}: ${c.detail}`);
    if (options.dry || !sheet.gate.passed) {
      writeDraft(sheet, `v${sheet.version}-deepen`);
      if (options.dry) writeManifest(t, m);
      out.push({ ticker: t, published: false, version: sheet.version });
      continue;
    }
    publish(sheet, { trigger: "rerun", callDate: null, monitorEventId: null });
    out.push({ ticker: t, published: true, version: sheet.version });
  }
  return out;
}

/**
 * Settles every outcome that most fact-checks dispute: one resolution run per
 * promise decides the outcome with sources, then a fresh fact-check judges it.
 * The disputing checks stay on file for provenance.
 *
 *   pnpm deepen --resolve
 */
export async function resolveDisputes(client: Parallel, tickers: string[], options: { log: Log }) {
  const { log } = options;
  const targets: Target[] = [];
  for (const t of tickers) {
    const sheet = rebuild(t);
    for (const p of sheet.promises) if (p.factCheck?.verdict === "incorrect") targets.push({ company: companyFor(t), pid: p.id });
  }
  log(`resolve: ${targets.length} disputed outcomes`);
  if (!targets.length) return [];
  const companies = [...new Set(targets.map((x) => x.company.ticker))];
  const built = new Map(companies.map((t) => [t, rebuild(t)] as [string, SheetData]));
  const checkRuns = (t: string, pid: string) =>
    [readManifest(t)!.checks?.[pid] ?? []].flat().map((id) => readRaw<StoredRun>(t, "check-run", id)).filter((r): r is StoredRun => !!r);
  const resolved = await runStage(client, targets, (x) => resolveRequest(x.company, built.get(x.company.ticker)!, x.pid, checkRuns(x.company.ticker, x.pid)), "resolve-run", RESOLVE_SPEC_KEY, log);
  for (const t of companies) {
    const m = readManifest(t)!;
    const resolves = { ...(m.resolves ?? {}) };
    const disputed = { ...(m.disputed ?? {}) };
    const checks = { ...(m.checks ?? {}) };
    for (const [k, runId] of resolved) {
      if (!k.startsWith(`${t}:`)) continue;
      const pid = k.split(":")[1];
      resolves[pid] = runId;
      disputed[pid] = checks[pid] ?? [];
      delete checks[pid];
    }
    writeManifest(t, { ...m, resolves, disputed, checks });
  }
  // A fresh fact-check of each settled outcome.
  const rebuilt = new Map(companies.map((t) => [t, rebuild(t)] as [string, SheetData]));
  const settled = targets.filter((x) => resolved.has(`${x.company.ticker}:${x.pid}`));
  const checks = await runStage(client, settled, (x) => checkRequest(x.company, rebuilt.get(x.company.ticker)!, x.pid), "check-run", CHECK_SPEC_KEY, log);
  const out: { ticker: string; published: boolean; version: number }[] = [];
  for (const t of companies) {
    const m = readManifest(t)!;
    const next = { ...(m.checks ?? {}) };
    for (const [k, runId] of checks) if (k.startsWith(`${t}:`)) next[k.split(":")[1]] = runId;
    writeManifest(t, { ...m, checks: next });
    const sheet = rebuild(t);
    for (const p of sheet.promises.filter((x) => x.resolved)) log(`  ${t} ${p.id}: ${p.resolved!.from} → ${p.status}; check ${p.factCheck?.verdict ?? "none"} · ${p.resolved!.reason}`);
    if (!sheet.gate.passed) {
      writeDraft(sheet, `v${sheet.version}-resolve`);
      out.push({ ticker: t, published: false, version: sheet.version });
      continue;
    }
    publish(sheet, { trigger: "rerun", callDate: null, monitorEventId: null });
    out.push({ ticker: t, published: true, version: sheet.version });
  }
  return out;
}

/**
 * Keeps every published outcome checked. Run after a poll publishes new
 * versions: new promises get a history and a check, outcomes a later call
 * changed get a fresh check, and any dispute goes to a vote and a resolution.
 */
export async function qualityPass(client: Parallel, tickers: string[], options: { asOf: string; log: Log }) {
  const { log } = options;
  const needHistory: string[] = [];
  const needCheck: string[] = [];
  for (const t of tickers) {
    const m = readManifest(t);
    if (!m) continue;
    for (const p of rebuild(t).promises) {
      if (!m.trails?.[p.id]) needHistory.push(`${t}:${p.id}`);
      else if (!p.factCheck) needCheck.push(`${t}:${p.id}`);
    }
  }
  if (needHistory.length) await deepen(client, tickers, { only: needHistory, asOf: options.asOf, log });
  if (needCheck.length) await deepen(client, tickers, { only: needCheck, checksOnly: true, asOf: options.asOf, log });
  await deepen(client, tickers, { vote: true, asOf: options.asOf, log });
  await resolveDisputes(client, tickers, { log });
}
