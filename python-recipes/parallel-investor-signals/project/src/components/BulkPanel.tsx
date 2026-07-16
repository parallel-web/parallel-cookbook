import { useCallback, useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import type { BulkJob, CustomFieldDef, Depth, ResearchBrief } from "../types";
import { bulkExportUrl, pollBulk, startBulk } from "../lib/api";
import { usableDefs } from "../lib/customFields";
import { CustomFieldsEditor } from "./CustomFieldsEditor";

// Pull a list of company identifiers out of an uploaded CSV: prefer a column
// named company/domain/name/account; otherwise fall back to the first column.
function companiesFromCsv(text: string): string[] {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true });
  const rows = parsed.data as string[][];
  if (!rows.length) return [];
  const header = rows[0].map((h) => (h || "").toLowerCase().trim());
  const preferred = ["company", "domain", "name", "account", "website"];
  let col = header.findIndex((h) => preferred.includes(h));
  const hasHeader = col !== -1 || header.some((h) => preferred.some((p) => h.includes(p)));
  if (col === -1) col = 0;
  const body = hasHeader ? rows.slice(1) : rows;
  return body.map((r) => (r[col] || "").trim()).filter(Boolean);
}

export function BulkPanel({ depth }: { depth: Depth }) {
  const [companies, setCompanies] = useState<string[]>([]);
  const [raw, setRaw] = useState("");
  const [job, setJob] = useState<BulkJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Batch-level custom questions -> one extra column each. Session-only state:
  // deliberately not persisted, so a refresh starts clean.
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  // `submittedDefs` is frozen at run time so result columns stay stable while
  // the job runs (independent of further edits to the editor).
  const [submittedDefs, setSubmittedDefs] = useState<CustomFieldDef[]>([]);
  const pollRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const running = job?.status === "running";

  // Parse a pasted list (newline or comma separated) into companies.
  const parsePasted = useCallback((text: string) => {
    setRaw(text);
    const list = text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    setCompanies(list);
  }, []);

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const list = companiesFromCsv(String(reader.result));
      setCompanies(list);
      setRaw(list.join("\n"));
    };
    reader.readAsText(file);
  };

  const run = async () => {
    if (!companies.length || running) return;
    setError(null);
    setJob(null);
    const defs = usableDefs(customFields);
    setSubmittedDefs(defs);
    try {
      const { job_id } = await startBulk(companies, depth, defs);
      setJob({ job_id, status: "running", done: 0, total: companies.length, results: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start enrichment.");
    }
  };

  // Poll the job while it runs. Cleaned up on unmount / completion.
  useEffect(() => {
    if (!job || job.status !== "running") return;
    pollRef.current = window.setInterval(async () => {
      try {
        const next = await pollBulk(job.job_id);
        setJob(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lost connection to the job.");
        if (pollRef.current) window.clearInterval(pollRef.current);
      }
    }, 1500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job?.job_id, job?.status]);

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="parallel-card p-5">
        <h2 className="text-lg text-ink">Bulk enrich a list</h2>
        <p className="mt-1 text-[13px] text-muted">
          Paste companies (one per line) or drop a CSV. We enrich every row and
          give you an enriched CSV back — the Monday-morning rep workflow.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <textarea
            value={raw}
            onChange={(e) => parsePasted(e.target.value)}
            placeholder={"ramp.com\nanthropic.com\nvercel.com"}
            rows={5}
            disabled={running}
            className="w-full rounded-brand border border-line bg-surface p-3 font-mono text-[13px] text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent disabled:opacity-60"
          />
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={running}
              className="rounded-brand border border-line px-3 py-2 font-mono text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Upload CSV
            </button>
            <button
              onClick={run}
              disabled={!companies.length || running}
              className="parallel-btn px-4 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? "Enriching…" : `Enrich ${companies.length || ""}`.trim()}
            </button>
          </div>
        </div>

        <CustomFieldsEditor defs={customFields} onChange={setCustomFields} disabled={running} />
      </div>

      {error && (
        <div className="parallel-card border-accent/40 px-4 py-3 text-[14px] text-ink">
          {error}
        </div>
      )}

      {job && (
        <div className="parallel-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 font-mono text-[12px] text-muted">
              {running && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />}
              <span>
                {job.done}/{job.total} enriched
              </span>
              <span className="text-muted/50">·</span>
              <span className="uppercase">{job.status}</span>
            </div>
            {job.status === "done" && (
              <a
                href={bulkExportUrl(job.job_id)}
                className="parallel-btn px-3 py-1.5 text-[12px]"
              >
                Export enriched CSV ↓
              </a>
            )}
          </div>

          {/* progress bar */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-accent transition-all duration-500"
              style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%` }}
            />
          </div>

          {job.results.length > 0 && (
            <BulkResultsTable results={job.results} customDefs={submittedDefs} />
          )}
        </div>
      )}
    </div>
  );
}

function BulkResultsTable({
  results,
  customDefs,
}: {
  results: ResearchBrief[];
  customDefs: CustomFieldDef[];
}) {
  // Columns come from the submitted defs (not the results), so they appear
  // immediately — before the first row returns.
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-line font-mono text-[10px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-normal">Company</th>
            <th className="px-3 py-2 font-normal">Industry</th>
            <th className="px-3 py-2 font-normal">Last round</th>
            <th className="px-3 py-2 font-normal">Employees</th>
            <th className="px-3 py-2 font-normal">Contacts</th>
            {customDefs.map((d) => (
              <th key={d.key ?? d.label} className="px-3 py-2 font-normal">
                {d.label || d.question}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((b, i) => {
            const cf = new Map(
              (b.custom_fields ?? []).map((c) => [c.key, c.field.value] as const),
            );
            return (
              <tr key={i} className="border-b border-line/60 last:border-b-0">
                <td className="px-3 py-2 text-ink">
                  {b.company_name}
                  {b.error && <span className="ml-2 font-mono text-[10px] text-accent">error</span>}
                </td>
                <td className="px-3 py-2 text-muted">{b.firmographics?.industry?.value ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{b.funding?.last_round?.value ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{b.firmographics?.employee_count?.value ?? "—"}</td>
                <td className="px-3 py-2 text-muted">{b.contacts?.length ?? 0}</td>
                {customDefs.map((d) => (
                  <td key={d.key ?? d.label} className="px-3 py-2 text-muted">
                    {cf.get(d.key ?? "") || "—"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
