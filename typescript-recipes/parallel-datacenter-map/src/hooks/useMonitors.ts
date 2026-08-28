"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Monitor } from "@/lib/types";

export interface SnapshotUpdate {
  facilityIndex: string;
  facilityName: string;
  timestamp: string;
  changedFields: string[];
  changes?: Record<string, { from: unknown; to: unknown }>;
  /** Per changed field: reasoning + sources from the re-verification run. */
  basis?: Record<string, { reasoning: string; citations: { url: string; title: string }[] }>;
}

export function useMonitors() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);
  const [snapshotUpdates, setSnapshotUpdates] = useState<Record<string, SnapshotUpdate>>({});
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchMonitors = useCallback(async () => {
    try {
      const res = await fetch("/api/monitors", { cache: "no-store" });
      if (!res.ok) return;
      const data: Monitor[] = await res.json();
      setMonitors(data);
      setLastChecked(new Date());
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  // Fetch existing snapshot updates on mount
  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await fetch("/api/snapshots", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.updates?.length) {
        setSnapshotUpdates((prev) => {
          const next = { ...prev };
          for (const u of data.updates) {
            next[u.facilityIndex] = {
              facilityIndex: u.facilityIndex,
              facilityName: u.facilityName,
              timestamp: u.timestamp,
              changedFields: u.changedFields,
              changes: u.changes,
              basis: u.basis,
            };
          }
          return next;
        });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchMonitors();
    fetchSnapshots();

    // SSE for real-time webhook events
    const es = new EventSource("/api/webhook");
    eventSourceRef.current = es;

    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);

        // Track snapshot updates
        if (event.facilityIndex && event.changedFields?.length > 0) {
          setSnapshotUpdates((prev) => ({
            ...prev,
            [event.facilityIndex]: {
              facilityIndex: event.facilityIndex,
              facilityName: event.facilityName || "",
              timestamp: event.receivedAt || new Date().toISOString(),
              changedFields: event.changedFields,
              changes: event.changes,
            },
          }));
        }

        // Refetch monitors for event_stream events
        if (event.type === "monitor.event.detected" && !event.facilityIndex) {
          fetchMonitors();
        }
      } catch {
        // ignore parse errors
      }
    };

    // Fallback poll
    const fallback = setInterval(fetchMonitors, 60_000);

    return () => {
      es.close();
      clearInterval(fallback);
    };
  }, [fetchMonitors]);

  const totalEvents = monitors.reduce((s, m) => s + m.events.length, 0);
  const totalFacilities = monitors.reduce((s, m) => s + m.facilityCount, 0);

  return {
    monitors,
    lastChecked,
    totalEvents,
    totalFacilities,
    loading,
    snapshotUpdates,
    refetch: fetchMonitors,
  };
}
