import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { getIssueNumber } from "../generate/route";

export const dynamic = "force-dynamic";

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";

function weekOf(issueNumber: number): string {
  const ms = new Date("2024-01-01").getTime() + issueNumber * 7 * 24 * 60 * 60 * 1000;
  return new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

interface IssueMeta {
  issueNumber: number;
  weekOf: string;
  hasContent: boolean;
  focus?: string;
  generatedAt?: string;
  stats?: { events?: number; critical?: number; markets?: number };
  isCurrent: boolean;
}

// GET: list every generated issue in the archive (newest first)
export async function GET() {
  const currentIssue = getIssueNumber();

  if (!BLOB_TOKEN) {
    return NextResponse.json({ currentIssue, issues: [] });
  }

  try {
    const { blobs } = await list({ prefix: "newsletters/issue-", token: BLOB_TOKEN });
    const issues: IssueMeta[] = [];

    await Promise.all(
      blobs.map(async (b) => {
        const m = b.pathname.match(/issue-(\d+)\.json$/);
        if (!m) return;
        const issueNumber = parseInt(m[1]);
        try {
          const res = await fetch(b.downloadUrl, { headers: { Authorization: `Bearer ${BLOB_TOKEN}` } });
          if (!res.ok) return;
          const d = await res.json();
          issues.push({
            issueNumber,
            weekOf: d.weekOf || weekOf(issueNumber),
            hasContent: !!d.content,
            focus: d.focus,
            generatedAt: d.generatedAt,
            stats: d.stats,
            isCurrent: issueNumber === currentIssue,
          });
        } catch {}
      })
    );

    issues.sort((a, b) => b.issueNumber - a.issueNumber);
    return NextResponse.json({ currentIssue, issues });
  } catch {
    return NextResponse.json({ currentIssue, issues: [] });
  }
}
