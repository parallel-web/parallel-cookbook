import "server-only";
import { db } from "./db";
import { env } from "./env";
import { monitorWebhookUrl } from "./webhook-token";
import { ParallelMonitorClient } from "@/lib/parallel/monitor-client";
import {
  generateMonitorQueries,
  MONITOR_OUTPUT_SCHEMA,
} from "@/lib/parallel/monitor-queries";
import type { VendorRow } from "./vendors";

export interface DeployedMonitor {
  vendorId: string;
  monitorId: string;
  dimension: string;
  category: string;
  cadence: string;
  query: string;
}

export async function deployMonitorsForVendor(
  accountId: string,
  apiKey: string,
  vendor: VendorRow,
): Promise<DeployedMonitor[]> {
  const e = env();
  const client = new ParallelMonitorClient({ apiKey, baseUrl: e.PARALLEL_BASE_URL });
  const webhook = await monitorWebhookUrl();

  const queries = generateMonitorQueries({
    vendor_name: vendor.vendor_name,
    vendor_domain: vendor.vendor_domain,
    vendor_category: vendor.vendor_category,
    monitoring_priority: vendor.monitoring_priority,
  });

  const created: DeployedMonitor[] = [];
  for (const qs of queries) {
    let monitor;
    try {
      // V1 contract: type discriminant + nested settings; processor
      // chosen per-dimension by the query generator (base on
      // high-priority cyber/legal, lite elsewhere). Metadata values are
      // strings to satisfy V1's `{ [key: string]: string }` constraint.
      monitor = await client.createMonitor({
        type: "event_stream",
        frequency: qs.frequency,
        processor: qs.processor,
        settings: {
          query: qs.query,
          output_schema: MONITOR_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
          include_backfill: false,
          advanced_settings: { location: "us" },
        },
        webhook: { url: webhook, event_types: ["monitor.event.detected"] },
        metadata: {
          vendor_name: vendor.vendor_name,
          vendor_domain: vendor.vendor_domain,
          monitor_category: qs.monitor_category,
          risk_dimension: qs.risk_dimension,
          account_id: accountId,
          vendor_id: vendor.id,
        },
      });
    } catch (err) {
      console.error(
        "[monitors] failed to create monitor",
        vendor.vendor_name,
        qs.risk_dimension,
        err,
      );
      continue;
    }

    const { error: insertErr } = await db().from("monitors").upsert(
      {
        account_id: accountId,
        vendor_id: vendor.id,
        parallel_monitor_id: monitor.monitor_id,
        dimension: qs.risk_dimension,
        monitor_category: qs.monitor_category,
        cadence: qs.cadence,
        query: qs.query,
        status: "active",
      },
      { onConflict: "parallel_monitor_id" },
    );
    if (insertErr) {
      // The remote monitor was created but we couldn't record it locally.
      // Roll back by cancelling the Parallel monitor so we don't leave a
      // billed ghost in the fleet (finding 9). If cancel also fails, write
      // an audit_log row so an operator can clean up manually.
      console.error("[monitors] failed to persist monitor row", insertErr);
      let cancelOk = false;
      try {
        await client.cancelMonitor(monitor.monitor_id);
        cancelOk = true;
      } catch (cancelErr) {
        console.error("[monitors] rollback cancel failed", cancelErr);
        try {
          await db().from("audit_log").insert({
            account_id: accountId,
            actor: "system",
            action: "monitors.deploy_orphan",
            subject: vendor.vendor_name,
            metadata: {
              parallel_monitor_id: monitor.monitor_id,
              dimension: qs.risk_dimension,
              db_error: String((insertErr as { message?: string }).message ?? insertErr),
              cancel_error: String((cancelErr as Error).message ?? cancelErr),
            },
          });
        } catch (auditErr) {
          console.error("[monitors] orphan audit insert failed", auditErr);
        }
      }
      // Either way, don't claim the monitor as `created` — the dashboard's
      // contract is "what you see is what's persisted". Move on so the
      // other dimensions still attempt deploy.
      void cancelOk;
      continue;
    }

    created.push({
      vendorId: vendor.id,
      monitorId: monitor.monitor_id,
      dimension: qs.risk_dimension,
      category: qs.monitor_category,
      cadence: qs.cadence,
      query: qs.query,
    });
  }

  await db().from("audit_log").insert({
    account_id: accountId,
    actor: "system",
    action: "monitors.deployed",
    subject: vendor.vendor_name,
    metadata: { count: created.length, monitor_ids: created.map((m) => m.monitorId) },
  });

  return created;
}

export async function deleteMonitor(
  accountId: string,
  apiKey: string,
  monitorRowId: string,
): Promise<void> {
  const e = env();
  const { data: row } = await db()
    .from("monitors")
    .select("id, parallel_monitor_id")
    .eq("id", monitorRowId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!row) throw new Error("Monitor not found");

  const client = new ParallelMonitorClient({ apiKey, baseUrl: e.PARALLEL_BASE_URL });
  try {
    // V1 cancellation is irreversible and idempotent — safe to call even
    // if the monitor has already been cancelled out-of-band.
    await client.cancelMonitor(row.parallel_monitor_id);
  } catch (err) {
    console.error("[monitors] failed to cancel remote monitor", err);
  }

  await db()
    .from("monitors")
    .delete()
    .eq("id", row.id)
    .eq("account_id", accountId);
}
