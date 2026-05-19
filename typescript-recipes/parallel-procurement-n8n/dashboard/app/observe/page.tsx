import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-ui";
import { ObserveWorkspace } from "@/components/observe/ObserveWorkspace";
import { requireAccount } from "@/lib/server/account";
import { getDashboardSnapshot } from "@/lib/server/dashboard-queries";

export const dynamic = "force-dynamic";

export default async function ObservePage() {
  const account = await requireAccount();
  if (!account.onboarded_at) redirect("/onboarding/profile");
  const data = await getDashboardSnapshot(account.id);

  return (
    <DashboardShell
      section="observe"
      title="Observe"
      subtitle="Visualize autonomous spawn chains, rule decisions, and chain-of-thought narratives across the entire campaign topology."
      lastUpdated={data.lastUpdated}
      account={{ displayName: account.display_name, email: account.email }}
    >
      <div className="observe-banner">
        Observe is a preview surface — populated from your real task graph in a later release.
      </div>
      <ObserveWorkspace />
    </DashboardShell>
  );
}
