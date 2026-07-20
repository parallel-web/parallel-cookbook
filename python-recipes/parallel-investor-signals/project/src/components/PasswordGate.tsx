import { useState } from "react";
import { verifyAccessKey } from "../lib/api";
import { setAccessKey } from "../lib/auth";
import wordmarkLight from "../assets/logo/wordmark_light.svg";
import wordmarkDark from "../assets/logo/wordmark_dark.svg";

// The demo access gate. Verifies the passphrase against the backend (which is
// the actual enforcement point — every /api route requires it), then stores it
// for the session. Styled like the rest of the console: calm, mono, one accent.
export function PasswordGate({
  theme,
  onUnlock,
}: {
  theme: "light" | "dark";
  onUnlock: () => void;
}) {
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = value.trim();
    if (!candidate || checking) return;
    setChecking(true);
    setFailed(false);
    try {
      const ok = await verifyAccessKey(candidate);
      if (ok) {
        setAccessKey(candidate);
        onUnlock();
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img
            src={theme === "dark" ? wordmarkDark : wordmarkLight}
            alt="Parallel"
            className="h-6 w-auto"
          />
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted">
            Sales Enrichment
          </span>
        </div>

        <form onSubmit={submit} className="parallel-card flex flex-col gap-3 p-5">
          <label htmlFor="gate-input" className="font-mono text-[11px] uppercase tracking-wide text-muted">
            Access key
          </label>
          <input
            id="gate-input"
            type="password"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setFailed(false);
            }}
            placeholder="Enter the demo passphrase"
            autoFocus
            autoComplete="off"
            disabled={checking}
            className="w-full rounded-brand border border-line bg-bg px-3 py-2.5 font-mono text-[14px] text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent disabled:opacity-60"
          />
          {failed && (
            <p className="font-mono text-[12px] text-accent">
              That key didn't unlock. Check with the person who shared this demo.
            </p>
          )}
          <button
            type="submit"
            disabled={!value.trim() || checking}
            className="parallel-btn mt-1 px-4 py-2.5 text-[14px] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {checking ? "Checking…" : "Unlock"}
          </button>
        </form>

        <p className="mt-4 text-center font-mono text-[11px] text-muted/60">
          Access key required.
        </p>
      </div>
    </div>
  );
}
