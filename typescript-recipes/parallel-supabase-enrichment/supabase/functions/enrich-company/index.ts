import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Parallel from "npm:parallel-web@0.2.4";
import { jsonResponse, handleCors } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/supabase.ts";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Static output schema for enrichment.
 * Customize this to change what fields get enriched.
 *
 * For dynamic schema based on database config, see the commented
 * buildDynamicSchema function below.
 */
const outputSchema = {
  type: "object",
  properties: {
    industry: {
      type: "string",
      description: "Primary industry the company operates in.",
    },
    employee_count: {
      type: "string",
      enum: [
        "1-10",
        "11-50",
        "51-200",
        "201-500",
        "501-1000",
        "1001-5000",
        "5000+",
        "Unknown",
      ],
      description: "Approximate number of employees.",
    },
    headquarters: {
      type: "string",
      description: 'Headquarters location in "City, Country" format.',
    },
    founded_year: {
      type: "string",
      description: "Year founded (YYYY format). Null if not found.",
    },
    funding_stage: {
      type: "string",
      description:
        "Latest funding stage (Seed, Series A, Series B, Public, Bootstrapped).",
    },
    total_funding: {
      type: "string",
      description:
        'Total funding raised (e.g., "$50M"). Null if unknown or bootstrapped.',
    },
    description: {
      type: "string",
      description: "1-2 sentence description of what the company does.",
    },
  },
  required: ["industry", "employee_count", "headquarters", "description"],
  additionalProperties: false,
};

// -----------------------------------------------------------------------------
// OPTIONAL: Dynamic schema from database
// Uncomment this section if you want to use the enrichment_columns table
// -----------------------------------------------------------------------------
// type EnrichmentColumn = {
//   name: string;
//   column_type: "text" | "number" | "enum";
//   description: string;
//   enum_values: string[] | null;
// };
//
// function buildDynamicSchema(columns: EnrichmentColumn[]) {
//   const properties: Record<string, unknown> = {};
//   const required: string[] = [];
//
//   for (const col of columns) {
//     const prop: Record<string, unknown> = { description: col.description };
//
//     if (col.column_type === "number") {
//       prop.type = "number";
//     } else if (col.column_type === "enum" && col.enum_values) {
//       prop.type = "string";
//       prop.enum = col.enum_values;
//     } else {
//       prop.type = "string";
//     }
//
//     properties[col.name] = prop;
//     required.push(col.name);
//   }
//
//   return { type: "object", properties, required, additionalProperties: false };
// }
// -----------------------------------------------------------------------------

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createSupabaseClient();
  let companyId: string | undefined;

  try {
    const body = await req.json();
    companyId = body.company_id;

    // Validate input
    if (!companyId) {
      return jsonResponse({ error: "company_id is required" }, 400);
    }
    if (!UUID_REGEX.test(companyId)) {
      return jsonResponse({ error: "Invalid company_id format" }, 400);
    }

    // Fetch the company record
    const { data: company, error: fetchError } = await supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .single();

    if (fetchError || !company) {
      return jsonResponse({ error: "Company not found" }, 404);
    }

    // Mark as processing
    await supabase
      .from("companies")
      .update({ enrichment_status: "processing" })
      .eq("id", companyId);

    // -------------------------------------------------------------------------
    // OPTIONAL: Fetch dynamic schema from database
    // Uncomment to use enrichment_columns table instead of static schema
    // -------------------------------------------------------------------------
    // const { data: columns, error: columnsError } = await supabase
    //   .from("enrichment_columns")
    //   .select("*")
    //   .order("sort_order");
    //
    // if (columnsError || !columns?.length) {
    //   throw new Error("No enrichment columns defined");
    // }
    // const dynamicSchema = buildDynamicSchema(columns as EnrichmentColumn[]);
    // -------------------------------------------------------------------------

    const parallelApiKey = Deno.env.get("PARALLEL_API_KEY");
    if (!parallelApiKey) {
      throw new Error("PARALLEL_API_KEY not configured");
    }
    const parallel = new Parallel({ apiKey: parallelApiKey });

    // Create the enrichment task
    const taskRun = await parallel.taskRun.create({
      input: {
        company_name: company.company_name,
        website: company.website || undefined,
      },
      // Change processor based on your speed/cost/quality needs:
      // base-fast, base, pro-fast, pro, ultra-fast, ultra
      processor: "base-fast",
      task_spec: {
        output_schema: {
          type: "json",
          json_schema: outputSchema,
          // Use dynamicSchema here if using database config
        },
      },
    });

    const runId = taskRun.run_id;

    // Store the run ID for polling
    await supabase
      .from("companies")
      .update({ parallel_run_id: runId })
      .eq("id", companyId);

    // Poll for results with timeout budget management:
    // - Supabase Edge Functions have a 50s timeout
    // - We poll up to 9 times with 5s timeout each = 45s max
    // - This leaves ~5s buffer for setup and database writes
    // If the task doesn't complete in time, it will be picked up by poll-enrichment
    let runResult;
    for (let attempt = 0; attempt < 9; attempt++) {
      try {
        runResult = await parallel.taskRun.result(runId, { timeout: 5 });
        break;
      } catch {
        // Timeout - keep polling
      }
    }

    // If we got a result, save it
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
        .eq("id", companyId);

      return jsonResponse({
        success: true,
        company_id: companyId,
        enriched_data: enrichedData,
      });
    }

    // Task still running - return success, client should poll for results
    return jsonResponse({
      success: true,
      company_id: companyId,
      status: "processing",
      run_id: runId,
      message: "Task is still processing. Poll for results.",
    });
  } catch (error) {
    console.error("Enrichment error:", error);

    // Mark the company as failed
    if (companyId) {
      await supabase
        .from("companies")
        .update({
          enrichment_status: "failed",
          enrichment_error: (error as Error).message,
        })
        .eq("id", companyId)
        .catch((err) => console.error("Failed to update error status:", err));
    }

    return jsonResponse(
      { error: (error as Error).message || "Enrichment failed" },
      500
    );
  }
});
