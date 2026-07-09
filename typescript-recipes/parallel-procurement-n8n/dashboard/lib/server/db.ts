import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let cached: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service-role key.
 * RLS is bypassed; the application is responsible for filtering by account_id.
 */
export function db(): SupabaseClient {
  if (cached) return cached;
  const e = env();
  cached = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
