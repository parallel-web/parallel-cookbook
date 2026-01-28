/**
 * Shared Supabase client utilities for Edge Functions.
 */
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * Create a Supabase client with service role credentials.
 * Use this for server-side operations that need full database access.
 */
export function createSupabaseClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}
