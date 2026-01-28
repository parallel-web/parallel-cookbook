import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Parallel from "npm:parallel-web@0.2.4";
import { jsonResponse, handleCors } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/supabase.ts";

/**
 * Poll for enrichment results on pending tasks.
 *
 * This function handles tasks that didn't complete within the
 * enrich-company function's timeout. Call it periodically to
 * check for completed results.
 *
 * For production, consider scheduling this with Supabase Cron:
 * https://supabase.com/docs/guides/functions/schedule-functions
 */
Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createSupabaseClient();

    const parallelApiKey = Deno.env.get("PARALLEL_API_KEY");
    if (!parallelApiKey) {
      throw new Error("PARALLEL_API_KEY not configured");
    }
    const parallel = new Parallel({ apiKey: parallelApiKey });

    // Get companies that are still processing with a run ID
    const { data: companies, error: fetchError } = await supabase
      .from("companies")
      .select("id, parallel_run_id")
      .eq("enrichment_status", "processing")
      .not("parallel_run_id", "is", null)
      .limit(10);

    if (fetchError) {
      throw new Error(`Failed to fetch companies: ${fetchError.message}`);
    }

    if (!companies?.length) {
      return jsonResponse({ message: "No pending tasks to poll" });
    }

    const results = await Promise.all(
      companies.map((company) => pollCompany(parallel, supabase, company))
    );

    return jsonResponse({ results });
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, 500);
  }
});

type PollResult = { id: string; status: string; error?: string };

async function pollCompany(
  parallel: Parallel,
  supabase: SupabaseClient,
  company: { id: string; parallel_run_id: string }
): Promise<PollResult> {
  try {
    // Short timeout - we're just checking, not waiting
    const runResult = await parallel.taskRun.result(company.parallel_run_id, {
      timeout: 2,
    });

    if (runResult?.output?.content) {
      const enrichedData =
        typeof runResult.output.content === "string"
          ? JSON.parse(runResult.output.content)
          : runResult.output.content;

      await supabase
        .from("companies")
        .update({
          enriched_data: enrichedData,
          enrichment_status: "completed",
          enriched_at: new Date().toISOString(),
        })
        .eq("id", company.id);

      return { id: company.id, status: "completed" };
    }

    return { id: company.id, status: "still_processing" };
  } catch (err) {
    const error = err as Error;

    // Timeout means still processing
    if (error.message?.includes("timeout") || error.message?.includes("408")) {
      return { id: company.id, status: "still_processing" };
    }

    // Actual error - mark as failed
    await supabase
      .from("companies")
      .update({
        enrichment_status: "failed",
        enrichment_error: error.message,
      })
      .eq("id", company.id);

    return { id: company.id, status: "failed", error: error.message };
  }
}
