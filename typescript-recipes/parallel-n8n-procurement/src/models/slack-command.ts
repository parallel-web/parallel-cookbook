// ── Slack Slash Command (inbound from Slack) ──────────────────────────────

export interface SlackSlashCommandPayload {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
  response_url: string;
  trigger_id: string;
}

// ── Parsed Command ─────────────────────────────────────────────────────────

export interface ParsedCommand {
  vendor_name: string;
  requesting_user: string;
  channel_id: string;
  response_url: string;
}

// ── Task Webhook Payload (inbound from Parallel) ───────────────────────────

export interface TaskWebhookPayload {
  run_id: string;
  status: string;
  channel_id?: string;
  thread_ts?: string;
  vendor_name?: string;
}

// ── Slack API Response ─────────────────────────────────────────────────────

export interface SlackResponse {
  ok: boolean;
  ts?: string;
  error?: string;
}
