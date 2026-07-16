import wordmarkLight from "../assets/logo/wordmark_light.svg";
import wordmarkDark from "../assets/logo/wordmark_dark.svg";

export type Mode = "home" | "single" | "bulk" | "signals";

// The Signals view is a dev/ops surface: visible in local dev, hidden on
// the deployed app by default (Slack is the production delivery channel).
// Flip VITE_SHOW_SIGNALS=1 at build time to expose it on a deploy.
export const SHOW_SIGNALS =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_SIGNALS === "1";

const MODE_LABEL: Record<Mode, string> = {
  home: "Home",
  single: "Enrich",
  bulk: "Bulk",
  signals: "Signals",
};

const VISIBLE_MODES: Mode[] = SHOW_SIGNALS
  ? ["home", "single", "bulk", "signals"]
  : ["home", "single", "bulk"];

// Top bar: real Parallel wordmark (correct variant per theme), the product
// name, a Home/Enrich/Bulk mode switch, and a theme toggle.
export function Header({
  theme,
  onToggleTheme,
  mode,
  onModeChange,
}: {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-3">
          {/* wordmark_light.svg is dark ink for light backgrounds, per brand */}
          <img
            src={theme === "dark" ? wordmarkDark : wordmarkLight}
            alt="Parallel"
            className="h-5 w-auto"
          />
          <span className="hidden h-4 w-px bg-line sm:block" />
          <span className="hidden font-mono text-[12px] uppercase tracking-wide text-muted sm:block">
            Sales Enrichment
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Mode switch */}
          <div className="flex rounded-brand border border-line p-0.5 font-mono text-[12px]">
            {VISIBLE_MODES.map((m) => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`rounded-[calc(var(--radius)-2px)] px-3 py-1 transition-colors ${
                  mode === m ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          <button
            onClick={onToggleTheme}
            className="rounded-brand border border-line px-2.5 py-1.5 text-muted transition-colors hover:border-accent hover:text-accent"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </div>
      </div>
    </header>
  );
}
