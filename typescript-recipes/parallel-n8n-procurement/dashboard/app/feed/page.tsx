import { DashboardShell, DashboardSetupState, FeedPagePanels } from "@/components/dashboard-ui";
import { loadDashboardData } from "@/lib/dashboard-data";

export default async function FeedPage() {
  const result = await loadDashboardData();

  if (!result.ok) {
    return (
      <DashboardShell
        section="feed"
        title="Feed"
        subtitle="Live monitoring stream with export and Slack-share controls for fast distribution."
      >
        <DashboardSetupState message={result.message} detail={result.detail} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      data={result.data}
      section="feed"
      title="Feed"
      subtitle="Live monitoring stream with export and Slack-share controls for fast distribution."
    >
      <FeedPagePanels />
    </DashboardShell>
  );
}
