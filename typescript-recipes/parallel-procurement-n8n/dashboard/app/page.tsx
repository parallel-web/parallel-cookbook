import { redirect } from "next/navigation";
import {
  DashboardShell,
  ImmediateAttentionPreview,
  MetricsBand,
  OverviewBottomGrid,
  WatchlistTable,
} from "@/components/dashboard-ui";
import { requireAccount } from "@/lib/server/account";
import { getDashboardSnapshot } from "@/lib/server/dashboard-queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const account = await requireAccount();
  if (!account.onboarded_at) {
    redirect("/onboarding/profile");
  }
  const data = await getDashboardSnapshot(account.id);

  return (
    <DashboardShell
      section="overview"
      title="Vendor intelligence overview"
      subtitle="Portfolio posture, immediate risks, and live monitoring signals in one operating surface."
      lastUpdated={data.lastUpdated}
      account={{ displayName: account.display_name, email: account.email }}
    >
      <MetricsBand data={data} />
      <ImmediateAttentionPreview data={data} />
      <WatchlistTable data={data} />
      <OverviewBottomGrid data={data} />
    </DashboardShell>
  );
}
