import type { ResearchBrief } from "../types";
import { FieldRow, SourceMarker } from "./FieldRow";
import { ConfidencePill } from "./ConfidencePill";

// A titled group of claims. The eyebrow number encodes nothing sequential —
// it's a section index for scannability, kept in mono to match the console.
function Section({
  index,
  title,
  className,
  children,
}: {
  index: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`parallel-card p-5${className ? ` ${className}` : ""}`}>
      <div className="mb-3 flex items-center gap-3 border-b border-line pb-3">
        <span className="font-mono text-[11px] text-accent">{index}</span>
        <h3 className="text-[13px] font-medium uppercase tracking-wide text-muted">
          {title}
        </h3>
      </div>
      <div>{children}</div>
    </section>
  );
}

export function AccountCard({ brief }: { brief: ResearchBrief }) {
  const { firmographics: f, funding: fn, technographics: t, buying_signals: bs } = brief;
  const custom = brief.custom_fields ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section index="01" title="Firmographics">
        <FieldRow label="Industry" group="Firmographics" field={f.industry} />
        <FieldRow label="Headquarters" group="Firmographics" field={f.hq} />
        <FieldRow label="Employees" group="Firmographics" field={f.employee_count} />
        <FieldRow label="Founded" group="Firmographics" field={f.founded_year} />
        <FieldRow label="Description" group="Firmographics" field={f.description} />
      </Section>

      <Section index="02" title="Funding & Financials">
        <FieldRow label="Total raised" group="Funding" field={fn.total_raised} />
        <FieldRow label="Last round" group="Funding" field={fn.last_round} />
        <FieldRow
          label="Investors"
          group="Funding"
          field={fn.investors}
          render={(v) => (
            <span className="flex flex-wrap gap-1.5">
              {v.map((inv) => (
                <span key={inv} className="rounded-brand bg-surface-2 px-1.5 py-0.5 text-[13px]">
                  {inv}
                </span>
              ))}
            </span>
          )}
        />
        <FieldRow label="Valuation" group="Funding" field={fn.valuation} />
        <FieldRow label="Revenue est." group="Funding" field={fn.revenue_estimate} />
      </Section>

      <Section index="03" title="Tech Stack">
        <FieldRow
          label="Technologies"
          group="Tech Stack"
          field={t.tech_stack}
          render={(v) => (
            <span className="flex flex-wrap gap-1.5">
              {v.map((tech) => (
                <span
                  key={tech}
                  className="rounded-brand border border-line px-1.5 py-0.5 font-mono text-[12px] text-ink"
                >
                  {tech}
                </span>
              ))}
            </span>
          )}
        />
      </Section>

      <Section index="04" title="Buying Signals">
        {bs.value && bs.value.length ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              {bs.confidence && <ConfidencePill confidence={bs.confidence} />}
              <SourceMarker label="Buying Signals" value={`${bs.value.length} signals`} citations={bs.citations} />
            </div>
            <ul className="flex flex-col gap-2">
              {bs.value.map((s, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 rounded-brand bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
                    {s.type}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] leading-snug text-ink">{s.headline}</p>
                    {s.date && (
                      <p className="mt-0.5 font-mono text-[11px] text-muted">{s.date}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="py-2 text-[14px] text-muted/60">No recent signals found.</p>
        )}
      </Section>

      {custom.length > 0 && (
        <Section index="05" title="Custom Research" className="lg:col-span-2">
          {custom.map((item) => (
            <FieldRow
              key={item.question}
              label={item.label}
              group="Custom research"
              field={item.field}
            />
          ))}
        </Section>
      )}
    </div>
  );
}
