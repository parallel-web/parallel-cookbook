import "server-only";
import { db } from "./db";
import {
  byteaToBytes,
  bytesToBytea,
  decryptApiKey,
  encryptApiKey,
  sha256Hex,
} from "./crypto";

export type IntegrationProvider = "parallel" | "slack" | "email";

export type IntegrationStatus = "active" | "revoked" | "failed";

export interface Integration {
  id: string;
  account_id: string;
  provider: IntegrationProvider;
  label: string;
  metadata: Record<string, unknown>;
  status: IntegrationStatus;
  is_default: boolean;
  secret_hash: string;
  last_used_at: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationWithSecret extends Integration {
  secret: string;
}

const SAFE_COLUMNS =
  "id, account_id, provider, label, metadata, status, is_default, secret_hash, last_used_at, last_test_at, last_test_ok, last_test_error, created_at, updated_at";

const ALL_COLUMNS = `${SAFE_COLUMNS}, encrypted_secret`;

interface RawIntegration extends Integration {
  encrypted_secret?: unknown;
}

function rowToIntegration(row: RawIntegration): Integration {
  const { encrypted_secret: _drop, ...rest } = row;
  void _drop;
  return rest as Integration;
}

export async function listIntegrations(accountId: string): Promise<Integration[]> {
  const { data, error } = await db()
    .from("integrations")
    .select(SAFE_COLUMNS)
    .eq("account_id", accountId)
    .order("provider", { ascending: true })
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToIntegration(r as RawIntegration));
}

export async function listIntegrationsByProvider(
  accountId: string,
  provider: IntegrationProvider,
): Promise<Integration[]> {
  const { data, error } = await db()
    .from("integrations")
    .select(SAFE_COLUMNS)
    .eq("account_id", accountId)
    .eq("provider", provider)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToIntegration(r as RawIntegration));
}

/**
 * Resolve the active (default + active-status) integration for a provider
 * and decrypt its secret. Returns null if none configured.
 */
export async function getActiveIntegration(
  accountId: string,
  provider: IntegrationProvider,
): Promise<IntegrationWithSecret | null> {
  const { data, error } = await db()
    .from("integrations")
    .select(ALL_COLUMNS)
    .eq("account_id", accountId)
    .eq("provider", provider)
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const secret = await decryptApiKey(byteaToBytes((data as RawIntegration).encrypted_secret));
  const safe = rowToIntegration(data as RawIntegration);
  return { ...safe, secret };
}

export async function requireIntegration(
  accountId: string,
  provider: IntegrationProvider,
): Promise<IntegrationWithSecret> {
  const integration = await getActiveIntegration(accountId, provider);
  if (!integration) {
    throw new Error(
      `No active ${provider} integration configured for this account. Add one in Settings.`,
    );
  }
  return integration;
}

export interface AddIntegrationInput {
  accountId: string;
  provider: IntegrationProvider;
  secret: string;
  label?: string;
  metadata?: Record<string, unknown>;
  makeDefault?: boolean;
  actor?: string;
}

/**
 * Insert a new integration row. If `makeDefault` is true (the default),
 * any existing rows for the same provider are demoted to is_default = false.
 * The plaintext secret is AES-GCM encrypted before insert; only the SHA-256
 * hash is stored alongside in plaintext (for dedup / audit display).
 */
export async function addIntegration(input: AddIntegrationInput): Promise<Integration> {
  const label = (input.label || "default").trim() || "default";
  const makeDefault = input.makeDefault !== false;

  if (makeDefault) {
    await db()
      .from("integrations")
      .update({ is_default: false })
      .eq("account_id", input.accountId)
      .eq("provider", input.provider);
  }

  const ciphertext = await encryptApiKey(input.secret);
  const hash = await sha256Hex(input.secret);

  const { data, error } = await db()
    .from("integrations")
    .upsert(
      {
        account_id: input.accountId,
        provider: input.provider,
        label,
        encrypted_secret: bytesToBytea(ciphertext),
        secret_hash: hash,
        metadata: input.metadata ?? {},
        status: "active",
        is_default: makeDefault,
      },
      { onConflict: "account_id,provider,label" },
    )
    .select(SAFE_COLUMNS)
    .single();

  if (error || !data) throw error ?? new Error("Failed to add integration");

  await writeAudit(input.accountId, input.actor ?? "user", "integration.added", input.provider, {
    label,
    integration_id: (data as Integration).id,
  });

  return rowToIntegration(data as RawIntegration);
}

export interface RotateIntegrationInput {
  accountId: string;
  integrationId: string;
  secret: string;
  actor?: string;
}

export async function rotateIntegration(input: RotateIntegrationInput): Promise<Integration> {
  const ciphertext = await encryptApiKey(input.secret);
  const hash = await sha256Hex(input.secret);

  const { data, error } = await db()
    .from("integrations")
    .update({
      encrypted_secret: bytesToBytea(ciphertext),
      secret_hash: hash,
      status: "active",
      last_test_at: null,
      last_test_ok: null,
      last_test_error: null,
    })
    .eq("id", input.integrationId)
    .eq("account_id", input.accountId)
    .select(SAFE_COLUMNS)
    .single();

  if (error || !data) throw error ?? new Error("Failed to rotate integration");

  await writeAudit(input.accountId, input.actor ?? "user", "integration.rotated", (data as Integration).provider, {
    integration_id: input.integrationId,
  });

  return rowToIntegration(data as RawIntegration);
}

export async function deleteIntegration(
  accountId: string,
  integrationId: string,
  actor: string = "user",
): Promise<void> {
  const { data: existing } = await db()
    .from("integrations")
    .select("provider, label")
    .eq("id", integrationId)
    .eq("account_id", accountId)
    .maybeSingle();

  const { error } = await db()
    .from("integrations")
    .delete()
    .eq("id", integrationId)
    .eq("account_id", accountId);
  if (error) throw error;

  if (existing) {
    await writeAudit(accountId, actor, "integration.deleted", existing.provider, {
      integration_id: integrationId,
      label: existing.label,
    });
  }
}

export async function updateIntegrationMetadata(
  accountId: string,
  integrationId: string,
  metadata: Record<string, unknown>,
  actor: string = "user",
): Promise<Integration> {
  const { data, error } = await db()
    .from("integrations")
    .update({ metadata })
    .eq("id", integrationId)
    .eq("account_id", accountId)
    .select(SAFE_COLUMNS)
    .single();
  if (error || !data) throw error ?? new Error("Integration not found");

  await writeAudit(accountId, actor, "integration.metadata_updated", (data as Integration).provider, {
    integration_id: integrationId,
  });
  return rowToIntegration(data as RawIntegration);
}

/**
 * Persist the outcome of an explicit `runTest()` call (POST /api/integrations
 * or PATCH-rotate). This is the only path that flips `status` between active
 * and failed — a runtime delivery failure (Slack 503, Resend rate limit, etc.)
 * uses {@link recordDeliveryFailure} below so a transient blip doesn't kick
 * the integration offline.
 *
 * accountId is required as defense-in-depth so a stray helper call with a
 * cross-tenant integrationId can't silently mutate someone else's row.
 */
export async function recordTestResult(
  accountId: string,
  integrationId: string,
  ok: boolean,
  errorMessage: string | null,
): Promise<void> {
  await db()
    .from("integrations")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: ok,
      last_test_error: ok ? null : (errorMessage ?? "Unknown error"),
      status: ok ? "active" : "failed",
    })
    .eq("id", integrationId)
    .eq("account_id", accountId);
}

/**
 * Record a runtime delivery failure (e.g. Slack 503, transient Resend error)
 * WITHOUT flipping the integration's `status`. The row stays `active` so the
 * next scheduled tick can retry; we only update the diagnostics fields the
 * dashboard surfaces.
 */
export async function recordDeliveryFailure(
  accountId: string,
  integrationId: string,
  errorMessage: string,
): Promise<void> {
  await db()
    .from("integrations")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: false,
      last_test_error: errorMessage,
    })
    .eq("id", integrationId)
    .eq("account_id", accountId);
}

export async function markIntegrationUsed(
  accountId: string,
  integrationId: string,
): Promise<void> {
  await db()
    .from("integrations")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", integrationId)
    .eq("account_id", accountId);
}

async function writeAudit(
  accountId: string,
  actor: string,
  action: string,
  subject: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db().from("audit_log").insert({
      account_id: accountId,
      actor,
      action,
      subject,
      metadata,
    });
  } catch (err) {
    console.error("[integrations] audit write failed", err);
  }
}
