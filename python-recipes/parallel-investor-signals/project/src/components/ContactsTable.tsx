import type { Contact } from "../types";
import { ConfidencePill } from "./ConfidencePill";
import { SourceMarker } from "./FieldRow";

// Renders the contact's best methods honestly: citation-backed emails/phones
// (up to 3, highest confidence first, per the ZoomInfo/RocketReach-preferring
// research prompt) if we found any, otherwise ONLY the inferred email
// pattern, clearly flagged. We never present a contact method as "verified"
// beyond what the source citation actually supports.
function ContactMethodsCell({ contact }: { contact: Contact }) {
  const cm = contact.contact_methods;
  const methods = cm.value ?? [];
  if (methods.length) {
    return (
      <span className="flex flex-col gap-1">
        {methods.map((m, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <a
              href={m.type === "email" ? `mailto:${m.value}` : `tel:${m.value}`}
              className="font-mono text-[13px] text-accent hover:underline"
            >
              {m.value}
            </a>
            {i === 0 && cm.confidence && <ConfidencePill confidence={cm.confidence} />}
          </span>
        ))}
        <SourceMarker
          label="Contact · Methods"
          value={methods.map((m) => m.value).join(", ")}
          citations={cm.citations}
        />
      </span>
    );
  }
  const inf = contact.inferred_email;
  if (inf.value) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-[13px] text-muted">{inf.value}</span>
        <ConfidencePill confidence="inferred" />
      </span>
    );
  }
  return <span className="text-muted/50">—</span>;
}

export function ContactsTable({ contacts }: { contacts: Contact[] }) {
  if (!contacts.length) {
    return (
      <p className="parallel-card p-5 text-[14px] text-muted/70">
        No decision-makers surfaced for this company.
      </p>
    );
  }

  return (
    <div className="parallel-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line font-mono text-[10px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5 font-normal">Name</th>
              <th className="px-4 py-2.5 font-normal">Title</th>
              <th className="px-4 py-2.5 font-normal">Seniority</th>
              <th className="px-4 py-2.5 font-normal">Contact</th>
              <th className="px-4 py-2.5 font-normal">LinkedIn</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={i} className="border-b border-line/60 last:border-b-0 align-top">
                <td className="px-4 py-3">
                  <span className="inline-flex items-baseline gap-1 text-[14px] text-ink">
                    {c.name.value ?? "—"}
                    <SourceMarker label="Contact · Name" value={c.name.value ?? ""} citations={c.name.citations} />
                  </span>
                </td>
                <td className="px-4 py-3 text-[14px] text-ink">{c.title.value ?? "—"}</td>
                <td className="px-4 py-3">
                  {c.seniority.value ? (
                    <span className="rounded-brand bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                      {c.seniority.value}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">
                  <ContactMethodsCell contact={c} />
                </td>
                <td className="px-4 py-3">
                  {c.linkedin_url.value ? (
                    <a
                      href={c.linkedin_url.value}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-mono text-[12px] text-accent hover:underline"
                    >
                      Profile ↗
                    </a>
                  ) : (
                    <span className="text-muted/50">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 font-mono text-[10px] text-muted">
        Emails marked <span className="text-accent">inferred</span> are pattern-derived, not verified.
      </p>
    </div>
  );
}
