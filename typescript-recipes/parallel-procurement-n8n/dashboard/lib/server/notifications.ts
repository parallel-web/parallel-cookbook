import "server-only";
import { db } from "./db";
import {
  getActiveIntegration,
  markIntegrationUsed,
  recordDeliveryFailure,
} from "./integrations";
import { postSlackMessage, sendResendEmail } from "./providers";

export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AlertContext {
  accountId: string;
  vendorName: string;
  vendorDomain?: string | null;
  riskLevel: AlertSeverity;
  summary: string;
  recommendation?: string | null;
  source?: "deep_research" | "monitor_event" | "adhoc";
  url?: string | null;
}

/**
 * Fan an alert out to every notification channel the account has configured
 * (Slack + Email). HIGH and CRITICAL trigger real-time alerts; MEDIUM and
 * LOW are no-ops here (they roll into the daily digest instead).
 *
 * All channels are best-effort: an error in Slack will not block email, and
 * neither will throw. The caller stays clean.
 */
export async function notifyAssessment(ctx: AlertContext): Promise<void> {
  if (ctx.riskLevel !== "HIGH" && ctx.riskLevel !== "CRITICAL") return;

  const account = await loadAccountForAlert(ctx.accountId);
  if (!account) return;

  await Promise.allSettled([
    notifyViaSlack(ctx, account),
    notifyViaEmail(ctx, account),
  ]);
}

interface AccountForAlert {
  email: string | null;
  display_name: string | null;
}

async function loadAccountForAlert(accountId: string): Promise<AccountForAlert | null> {
  const { data } = await db()
    .from("accounts")
    .select("email, display_name")
    .eq("id", accountId)
    .maybeSingle();
  return (data as AccountForAlert | null) ?? null;
}

async function notifyViaSlack(ctx: AlertContext, _account: AccountForAlert): Promise<void> {
  void _account;
  let integration;
  try {
    integration = await getActiveIntegration(ctx.accountId, "slack");
  } catch (err) {
    console.error("[notify/slack] lookup failed", err);
    return;
  }
  if (!integration) return;

  const channel =
    typeof integration.metadata?.channel === "string" && integration.metadata.channel
      ? (integration.metadata.channel as string)
      : "#general";

  const text = formatSlackText(ctx);

  const result = await postSlackMessage({ token: integration.secret, channel, text });
  if (result.ok) {
    await markIntegrationUsed(ctx.accountId, integration.id);
  } else {
    // Runtime delivery failure — record diagnostics but DON'T flip the
    // integration to status="failed". An explicit re-test (POST/PATCH or
    // the Settings test button) is the only thing that should do that.
    await recordDeliveryFailure(
      ctx.accountId,
      integration.id,
      result.error ?? "Slack delivery failed",
    );
    console.error("[notify/slack] post failed", result.error);
  }
}

async function notifyViaEmail(ctx: AlertContext, account: AccountForAlert): Promise<void> {
  if (!account.email) return;

  let integration;
  try {
    integration = await getActiveIntegration(ctx.accountId, "email");
  } catch (err) {
    console.error("[notify/email] lookup failed", err);
    return;
  }
  if (!integration) return;

  const from = typeof integration.metadata?.from === "string" && integration.metadata.from
    ? (integration.metadata.from as string)
    : "Procurement Risk <onboarding@resend.dev>";

  const subject = `${emoji(ctx.riskLevel)} ${ctx.riskLevel}: ${ctx.vendorName}`;
  const html = formatEmailHtml(ctx, account);

  const result = await sendResendEmail({
    apiKey: integration.secret,
    from,
    to: account.email,
    subject,
    html,
  });

  if (result.ok) {
    await markIntegrationUsed(ctx.accountId, integration.id);
  } else {
    // Same split as Slack — log diagnostics but leave status alone.
    await recordDeliveryFailure(
      ctx.accountId,
      integration.id,
      result.error ?? "Email delivery failed",
    );
    console.error("[notify/email] send failed", result.error);
  }
}

function emoji(level: AlertSeverity): string {
  switch (level) {
    case "CRITICAL":
      return "🔴";
    case "HIGH":
      return "🟠";
    case "MEDIUM":
      return "🟡";
    default:
      return "⚪️";
  }
}

function formatSlackText(ctx: AlertContext): string {
  const lines = [
    `${emoji(ctx.riskLevel)} *${ctx.riskLevel}* — ${ctx.vendorName}${ctx.vendorDomain ? ` (${ctx.vendorDomain})` : ""}`,
    ctx.summary,
  ];
  if (ctx.recommendation) {
    lines.push(`Recommendation: \`${ctx.recommendation}\``);
  }
  if (ctx.url) {
    lines.push(`<${ctx.url}|Open in dashboard>`);
  }
  if (ctx.source) {
    lines.push(`_source: ${ctx.source}_`);
  }
  return lines.join("\n");
}

function formatEmailHtml(ctx: AlertContext, account: AccountForAlert): string {
  const greeting = account.display_name ? `Hi ${escapeHtml(account.display_name)},` : "Hi,";
  return `
<div style="font-family:-apple-system,Segoe UI,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
  <h2 style="margin:0 0 16px;color:${ctx.riskLevel === "CRITICAL" ? "#b91c1c" : "#c2410c"}">
    ${emoji(ctx.riskLevel)} ${ctx.riskLevel}: ${escapeHtml(ctx.vendorName)}
  </h2>
  <p style="margin:0 0 16px">${greeting}</p>
  <p style="margin:0 0 16px">${escapeHtml(ctx.summary)}</p>
  ${ctx.recommendation ? `<p style="margin:0 0 16px"><strong>Recommendation:</strong> ${escapeHtml(ctx.recommendation)}</p>` : ""}
  ${ctx.url ? `<p style="margin:0 0 16px"><a href="${ctx.url}" style="color:#2563eb">Open in dashboard →</a></p>` : ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
  <p style="margin:0;color:#6b7280;font-size:12px">
    Sent by Parallel Procurement using your Resend API key.
    Manage notifications in <a href="${ctx.url ? new URL("/settings/keys", ctx.url).toString() : "/settings/keys"}" style="color:#6b7280">Settings → Keys</a>.
  </p>
</div>`.trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
