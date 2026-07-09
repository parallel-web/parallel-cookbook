import "server-only";
import { db } from "./db";
import { requireIntegration } from "./integrations";
import { readSessionFromCookies } from "./session";

export interface Account {
  id: string;
  display_name: string | null;
  email: string | null;
  onboarded_at: string | null;
  created_at: string;
}

export interface AccountWithKey extends Account {
  parallelApiKey: string;
  /** Integration row id, used by callers that want to mark it `used`. */
  parallelIntegrationId: string;
}

export async function getCurrentAccount(): Promise<Account | null> {
  const session = await readSessionFromCookies();
  if (!session) return null;
  const { data, error } = await db()
    .from("accounts")
    .select("id, display_name, email, onboarded_at, created_at")
    .eq("id", session.accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Account;
}

export async function requireAccount(): Promise<Account> {
  const account = await getCurrentAccount();
  if (!account) {
    throw new HttpError(401, "Not signed in");
  }
  return account;
}

/**
 * Resolve the current account and decrypt their active Parallel API key
 * via the integrations layer. Use this inside server route handlers that
 * call the Parallel API on behalf of the user.
 */
export async function requireAccountWithKey(): Promise<AccountWithKey> {
  const account = await requireAccount();
  let integration;
  try {
    integration = await requireIntegration(account.id, "parallel");
  } catch (err) {
    throw new HttpError(412, err instanceof Error ? err.message : String(err));
  }
  return {
    ...account,
    parallelApiKey: integration.secret,
    parallelIntegrationId: integration.id,
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
