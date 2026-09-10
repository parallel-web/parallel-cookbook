import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
// Derive blob store host from ENRICHMENTS_BLOB_URL (e.g., https://xxx.private.blob.vercel-storage.com/enrichments.json)
const BLOB_STORE = (() => {
  const url = process.env.ENRICHMENTS_BLOB_URL || "";
  try { return new URL(url).host; } catch { return ""; }
})();

/**
 * Fetches basis data for a single facility from Vercel Blob.
 * Each facility is stored as its own ~95KB file: enrichments/{index}.json
 * No more loading 181MB into memory.
 */
export async function GET(request: NextRequest) {
  const facilityIndex = request.nextUrl.searchParams.get("facility");
  const field = request.nextUrl.searchParams.get("field");

  if (!facilityIndex) {
    return NextResponse.json({ error: "Missing facility param" }, { status: 400 });
  }

  // Fetch this one facility's enrichment from Blob (~95KB)
  let entry: {
    enrichment?: Record<string, unknown>;
    basis?: { field?: string; reasoning?: string; citations?: { url?: string; title?: string; excerpts?: string[] }[] }[];
  } | null = null;

  try {
    const url = `https://${BLOB_STORE}/enrichments/${facilityIndex}.json`;
    const res = await fetch(url, {
      headers: BLOB_TOKEN ? { Authorization: `Bearer ${BLOB_TOKEN}` } : {},
      cache: "no-store",
    });

    if (res.ok) {
      entry = await res.json();
    }
  } catch {
    // Blob fetch failed
  }

  // Dev fallback: read from local file
  if (!entry) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const filePath = path.join(process.cwd(), "public/data/enrichments.json");
      if (fs.existsSync(filePath)) {
        const all = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        entry = all[facilityIndex] || null;
      }
    } catch {}
  }

  if (!entry) {
    return NextResponse.json({ citations: [], reasoning: "" });
  }

  const basis = entry.basis || [];

  if (field) {
    const fieldBasis = basis.filter((b) => b.field === field);
    const reasoning = fieldBasis[0]?.reasoning || "";
    const citations = fieldBasis.flatMap((b) =>
      (b.citations || []).map((c) => ({
        field: b.field || "",
        url: c.url || "",
        title: c.title || "Source",
        excerpts: c.excerpts || [],
      }))
    );
    return NextResponse.json({ citations, reasoning });
  }

  const citations = basis.flatMap((b) =>
    (b.citations || []).map((c) => ({
      field: b.field || "",
      url: c.url || "",
      title: c.title || "Source",
    }))
  );
  const reasoning: Record<string, string> = {};
  for (const b of basis) {
    if (b.field && b.reasoning) reasoning[b.field] = b.reasoning;
  }

  return NextResponse.json({ citations, reasoning });
}
