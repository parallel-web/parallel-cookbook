import {
  ActionCard,
  DashboardShell,
  DashboardSetupState,
  ImmediateAttentionPreview,
  MetricsBand,
  OverviewBottomGrid,
  WatchlistTable,
} from "@/components/dashboard-ui";
import { loadDashboardData } from "@/lib/dashboard-data";

export default async function HomePage() {
  const result = await loadDashboardData();

  if (!result.ok) {
    return (
      <DashboardShell
        section="overview"
        title="Vendor intelligence overview"
        subtitle="Portfolio posture, immediate risks, and live monitoring signals in one operating surface."
      >
        <DashboardSetupState message={result.message} detail={result.detail} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      data={result.data}
      section="overview"
      title="Vendor intelligence overview"
      subtitle="Portfolio posture, immediate risks, and live monitoring signals in one operating surface."
      aside={<ActionCard />}
    >
      <MetricsBand />
      <ImmediateAttentionPreview />
      <WatchlistTable />
      <OverviewBottomGrid />
    </DashboardShell>
  );
}
