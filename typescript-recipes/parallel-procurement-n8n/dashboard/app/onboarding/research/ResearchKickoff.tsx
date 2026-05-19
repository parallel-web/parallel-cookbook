"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MonitoringPriority } from "@/lib/types/dashboard";

interface VendorSummary {
  id: string;
  vendor_name: string;
  monitoring_priority: MonitoringPriority;
}

interface Progress {
  total: number;
  completed: number;
  failed: number;
  isActive: boolean;
}

const MONITORS_PER_PRIORITY: Record<MonitoringPriority, number> = {
  high: 5,
  medium: 3,
  low: 2,
};

export function ResearchKickoff({ vendors }: { vendors: VendorSummary[] }) {
  const router = useRouter();
  const [taskGroupId, setTaskGroupId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "starting" | "researching" | "deploying" | "complete" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const monitorTotal = vendors.reduce(
    (sum, v) => sum + (MONITORS_PER_PRIORITY[v.monitoring_priority] ?? 3),
    0,
  );

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function startResearch() {
    setPhase("starting");
    setError(null);
    try {
      const res = await fetch("/api/research/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      const json = (await res.json()) as { taskGroupId: string; total: number };
      setTaskGroupId(json.taskGroupId);
      setProgress({
        total: json.total,
        completed: 0,
        failed: 0,
        isActive: true,
      });
      setPhase("researching");
      pollRef.current = setInterval(() => poll(json.taskGroupId), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function poll(groupId: string) {
    try {
      const res = await fetch(`/api/research/groups/${groupId}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as Progress & { status: string };
      setProgress({
        total: json.total,
        completed: json.completed,
        failed: json.failed,
        isActive: json.isActive,
      });
      if (!json.isActive) {
        if (pollRef.current) clearInterval(pollRef.current);
        await completeOnboarding();
      }
    } catch (err) {
      console.error("[onboarding/research] poll failed", err);
    }
  }

  async function completeOnboarding() {
    setPhase("deploying");
    try {
      const res = await fetch("/api/onboarding/complete", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      setPhase("complete");
      setTimeout(() => router.push("/"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  function skipToDashboard() {
    router.push("/");
  }

  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? vendors.length;
  const failed = progress?.failed ?? 0;
  const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

  return (
    <div className="onboarding-card">
      <div className="research-progress">
        <div className="research-progress-stats">
          <span>
            {completed} / {total} vendors researched
          </span>
          {failed > 0 ? <span>{failed} failed</span> : null}
          <span>{percent}%</span>
        </div>
        <div className="research-progress-bar">
          <span style={{ width: `${percent}%` }} />
        </div>
        <p className="research-progress-tip">
          We will deploy {monitorTotal} continuous monitors after research completes,
          using a high/medium/low portfolio matched to each vendor&apos;s priority.
        </p>
      </div>

      {phase === "idle" ? (
        <div className="onboarding-actions">
          <a href="/onboarding/vendors" className="onboarding-cta secondary">
            Back
          </a>
          <button type="button" className="onboarding-cta" onClick={startResearch}>
            Start research for {vendors.length} vendor{vendors.length === 1 ? "" : "s"}
          </button>
        </div>
      ) : null}

      {phase === "starting" ? (
        <div className="onboarding-helper">Submitting task group to Parallel…</div>
      ) : null}

      {phase === "researching" ? (
        <div>
          <p className="onboarding-helper">
            Research is running on the Parallel Task API. You can leave this page;
            we&apos;ll continue in the background and finalize when results land.
          </p>
          <div className="onboarding-actions">
            <button
              type="button"
              className="onboarding-cta secondary"
              onClick={skipToDashboard}
            >
              Continue in the background
            </button>
          </div>
        </div>
      ) : null}

      {phase === "deploying" ? (
        <div className="onboarding-helper">
          Deploying continuous monitors and finalizing your workspace…
        </div>
      ) : null}

      {phase === "complete" ? (
        <div className="onboarding-helper">All set. Loading your dashboard…</div>
      ) : null}

      {phase === "error" && error ? (
        <div className="onboarding-error">{error}</div>
      ) : null}

      {taskGroupId ? (
        <details className="onboarding-helper">
          <summary>Task group {taskGroupId}</summary>
          Tracking via <code>/api/research/groups/{taskGroupId}</code>.
        </details>
      ) : null}
    </div>
  );
}
