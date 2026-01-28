import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. " +
    "Copy .env.example to .env.local and fill in your credentials."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type EnrichmentStatus = "pending" | "processing" | "completed" | "failed";

export type Company = {
  id: string;
  created_at: string;
  updated_at: string;
  company_name: string;
  website: string | null;
  enriched_data: Record<string, unknown>;
  enrichment_status: EnrichmentStatus;
  enrichment_error: string | null;
  enriched_at: string | null;
  parallel_run_id: string | null;
};

// Enrichment fields displayed in the table (matches the output schema)
export const ENRICHMENT_FIELDS = [
  { key: "industry", label: "Industry" },
  { key: "employee_count", label: "Employees" },
  { key: "headquarters", label: "Headquarters" },
  { key: "founded_year", label: "Founded" },
  { key: "funding_stage", label: "Funding Stage" },
  { key: "total_funding", label: "Total Funding" },
  { key: "description", label: "Description" },
] as const;
