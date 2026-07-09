import { NextResponse } from "next/server";
import { HttpError, requireAccountWithKey } from "@/lib/server/account";
import { db } from "@/lib/server/db";
import { refreshTaskGroupStatus } from "@/lib/server/research";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskGroupId: string }> },
) {
  try {
    const { taskGroupId } = await context.params;
    const account = await requireAccountWithKey();

    const { data: row } = await db()
      .from("task_groups")
      .select("task_group_id, total_runs, completed_runs, failed_runs, status, kind")
      .eq("account_id", account.id)
      .eq("task_group_id", taskGroupId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: "Task group not found" }, { status: 404 });
    }

    const live = await refreshTaskGroupStatus(
      account.id,
      account.parallelApiKey,
      taskGroupId,
    );

    return NextResponse.json({
      taskGroupId,
      total: live.total,
      completed: live.completed,
      failed: live.failed,
      isActive: live.isActive,
      status: live.isActive
        ? "running"
        : live.failed === live.total
          ? "failed"
          : "completed",
    });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api/research/groups] error", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
