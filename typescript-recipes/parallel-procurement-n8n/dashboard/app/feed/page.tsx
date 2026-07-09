import { redirect } from "next/navigation";
import { DashboardShell, FeedPagePanels } from "@/components/dashboard-ui";
import { requireAccount } from "@/lib/server/account";
import { getDashboardSnapshot } from "@/lib/server/dashboard-queries";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const account = await requireAccount();
  if (!account.onboarded_at) redirect("/onboarding/profile");
  const data = await getDashboardSnapshot(account.id);

  return (
    <DashboardShell
      section="feed"
      title="Feed"
      subtitle="Live monitor events as they arrive from Parallel."
      lastUpdated={data.lastUpdated}
      account={{ displayName: account.display_name, email: account.email }}
    >
      <FeedPagePanels data={data} />
    </DashboardShell>
  );
}
