// ── Cleanup Result ─────────────────────────────────────────────────────────

export interface CleanupResult {
  deleted: number;
  failed: number;
  errors: string[];
}

// ── Recreation Result ──────────────────────────────────────────────────────

export interface RecreationResult {
  recreated: number;
  failed: number;
  new_monitor_ids: string[];
  errors: string[];
}

// ── Health Check Report ────────────────────────────────────────────────────

export interface HealthCheckReport {
  timestamp: string;
  total_monitors: number;
  active_count: number;
  failed_count: number;
  orphan_count: number;
  orphans_deleted: number;
  monitors_recreated: number;
  webhook_healthy: boolean;
  errors: string[];
}
