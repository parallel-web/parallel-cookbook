import { DashboardShell, DashboardSetupState } from "@/components/dashboard-ui";
import { PortfolioTableManager } from "@/components/PortfolioTableManager";
import { loadDashboardData } from "@/lib/dashboard-data";

export default async function PortfolioPage() {
  const result = await loadDashboardData();

  if (!result.ok) {
    return (
      <DashboardShell
        section="portfolio"
        title="Portfolio"
        subtitle="Vendor roster management, ownership alignment, and risk posture controls."
      >
        <DashboardSetupState message={result.message} detail={result.detail} />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      data={result.data}
      section="portfolio"
      title="Portfolio"
      subtitle="Vendor roster management, ownership alignment, and risk posture controls."
    >
      <PortfolioTableManager />
    </DashboardShell>
  );
}
