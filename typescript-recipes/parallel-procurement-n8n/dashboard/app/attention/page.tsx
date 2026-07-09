import { redirect } from "next/navigation";
import { AttentionQueuePage, DashboardShell } from "@/components/dashboard-ui";
import { requireAccount } from "@/lib/server/account";
import { getDashboardSnapshot } from "@/lib/server/dashboard-queries";

export const dynamic = "force-dynamic";

export default async function AttentionPage() {
  const account = await requireAccount();
  if (!account.onboarded_at) redirect("/onboarding/profile");
  const data = await getDashboardSnapshot(account.id);

  return (
    <DashboardShell
      section="attention"
      title="Immediate attention queue"
      subtitle="Time-bound actions that need procurement, legal, security, or monitoring review right now."
      lastUpdated={data.lastUpdated}
      account={{ displayName: account.display_name, email: account.email }}
    >
      <AttentionQueuePage data={data} />
    </DashboardShell>
  );
}
