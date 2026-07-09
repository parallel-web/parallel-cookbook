import { AttentionQueuePage, DashboardShell, DashboardSetupState } from "@/components/dashboard-ui";
import { loadDashboardData } from "@/lib/dashboard-data";

export default async function AttentionPage() {
  const result = await loadDashboardData();

  if (!result.ok) {
    return (
      <DashboardShell
        section="attention"
        title="Immediate attention queue"
        subtitle="Time-bound actions that need procurement, legal, security, or monitoring review right now."
      >
        <DashboardSetupState message={result.message} detail={result.detail} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      data={result.data}
      section="attention"
      title="Immediate attention queue"
      subtitle="Time-bound actions that need procurement, legal, security, or monitoring review right now."
    >
      <AttentionQueuePage />
    </DashboardShell>
  );
}
