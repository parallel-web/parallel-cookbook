import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/supabase-edge";

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  return callEdgeFunction({ functionName: "enrich-company", body });
}
