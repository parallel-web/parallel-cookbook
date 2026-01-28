import { callEdgeFunction } from "@/lib/supabase-edge";

export async function POST() {
  return callEdgeFunction({ functionName: "poll-enrichment" });
}
