import { notFound } from "next/navigation";

import { SheetView } from "../../../components/SheetView";
import { SiteFooter, SiteHeader } from "../../../components/SiteHeader";
import { loadSheet } from "../../../lib/data";
import { todayIso } from "../../../lib/dates";
import { asOfLine } from "../../../lib/view";

export const dynamic = "force-dynamic";

/** One company: the tear sheet and its paper trail. `focus` picks the promise. */
export default async function CompanyPage({ params, searchParams }: { params: Promise<{ ticker: string }>; searchParams: Promise<{ focus?: string }> }) {
  const { ticker } = await params;
  const { focus } = await searchParams;
  const sheet = await loadSheet(ticker);
  if (!sheet) notFound();
  return (
    <div>
      <SiteHeader />
      <main className="wrap">
        <SheetView key={`${sheet.ticker}-${sheet.version}`} sheet={sheet} today={todayIso()} initialFocus={focus ?? null} />
      </main>
      <SiteFooter asOf={asOfLine(sheet.asOf)} />
    </div>
  );
}
