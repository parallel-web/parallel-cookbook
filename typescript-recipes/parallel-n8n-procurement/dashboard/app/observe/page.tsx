import { DashboardShell, DashboardSetupState } from "@/components/dashboard-ui";
import { ObserveWorkspace } from "@/components/observe/ObserveWorkspace";
import { loadDashboardData } from "@/lib/dashboard-data";

export default async function ObservePage() {
  const result = await loadDashboardData();

  if (!result.ok) {
    return (
      <DashboardShell
        section="observe"
        title="Observe"
        subtitle="Visualize autonomous spawn chains, rule decisions, and chain-of-thought narratives across the entire campaign topology."
      >
        <DashboardSetupState message={result.message} detail={result.detail} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      data={result.data}
      section="observe"
      title="Observe"
      subtitle="Visualize autonomous spawn chains, rule decisions, and chain-of-thought narratives across the entire campaign topology."
    >
      <ObserveWorkspace />
    </DashboardShell>
  );
}
