"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, RefreshCw } from "lucide-react";

export function VendorActions({
  vendorId,
  hasMonitors,
}: {
  vendorId: string;
  hasMonitors: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"research" | "monitors" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runResearch() {
    setError(null);
    setBusy("research");
    try {
      const res = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorIds: [vendorId] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deployMonitors() {
    setError(null);
    setBusy("monitors");
    try {
      const res = await fetch("/api/monitors/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorIds: [vendorId] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="vendor-actions">
      <button
        type="button"
        className="vendor-action-button"
        onClick={runResearch}
        disabled={busy !== null}
      >
        <RefreshCw size={14} />
        {busy === "research" ? "Starting research…" : "Run research now"}
      </button>
      <button
        type="button"
        className="vendor-action-button secondary"
        onClick={deployMonitors}
        disabled={busy !== null}
      >
        <Activity size={14} />
        {busy === "monitors"
          ? "Deploying…"
          : hasMonitors
            ? "Redeploy monitors"
            : "Deploy monitors"}
      </button>
      {error ? <div className="vendor-action-error">{error}</div> : null}
    </div>
  );
}
