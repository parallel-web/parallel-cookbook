import { useState } from "react";
import type { SavedProfile } from "../lib/profiles";
import { agoLabel } from "../lib/cache";

// The rep's dashboard: previews of saved company profiles. Click a card to open
// it, ✕ (then confirm) to delete, or start a fresh enrichment with New profile.
export function HomePage({
  profiles,
  onOpen,
  onDelete,
  onNew,
}: {
  profiles: SavedProfile[];
  onOpen: (p: SavedProfile) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  // Two-step delete: first click arms, second confirms.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl leading-none text-ink">Your profiles</h1>
          <p className="mt-1.5 text-[13px] text-muted">
            Saved account briefs — every field cited, refreshable any time.
          </p>
        </div>
        <button
          onClick={onNew}
          className="parallel-btn px-4 py-2 text-[13px] transition-opacity hover:opacity-90"
        >
          + New profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="parallel-card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <p className="text-[15px] text-ink">No saved profiles yet.</p>
          <p className="max-w-md text-[13px] text-muted">
            Enrich a company, then hit <span className="font-mono">Save profile</span> on its
            brief — it'll show up here for one-click access before your next call.
          </p>
          <button
            onClick={onNew}
            className="mt-1 parallel-btn px-4 py-2 text-[13px] transition-opacity hover:opacity-90"
          >
            Enrich your first company
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((p) => {
            const b = p.brief;
            const industry = b.firmographics.industry.value;
            const description = b.firmographics.description.value;
            const customCount = b.custom_fields?.length ?? 0;
            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(p)}
                onKeyDown={(e) => e.key === "Enter" && onOpen(p)}
                className="parallel-card group flex cursor-pointer flex-col gap-2 p-4 text-left transition-colors hover:border-accent/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-[16px] font-medium text-ink">
                      {b.company_name}
                    </h2>
                    {b.domain && (
                      <p className="truncate font-mono text-[11px] text-accent">{b.domain}</p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmId === p.id) {
                        setConfirmId(null);
                        onDelete(p.id);
                      } else {
                        setConfirmId(p.id);
                      }
                    }}
                    aria-label={confirmId === p.id ? "Confirm delete" : `Delete ${b.company_name}`}
                    className={`shrink-0 rounded-brand border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                      confirmId === p.id
                        ? "border-accent text-accent"
                        : "border-line text-muted/60 hover:border-accent hover:text-accent"
                    }`}
                  >
                    {confirmId === p.id ? "delete?" : "✕"}
                  </button>
                </div>

                {industry && (
                  <span className="w-fit rounded-brand bg-surface-2 px-1.5 py-0.5 text-[12px] text-muted">
                    {industry}
                  </span>
                )}
                {description && (
                  <p className="line-clamp-2 text-[13px] leading-snug text-muted">{description}</p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] text-muted/70">
                  <span>updated {agoLabel(p.updatedAt)}</span>
                  <span className="text-muted/40">·</span>
                  <span>{b.contacts.length} contacts</span>
                  {customCount > 0 && (
                    <>
                      <span className="text-muted/40">·</span>
                      <span>{customCount} custom</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
