import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-ui";
import { PortfolioTableManager } from "@/components/PortfolioTableManager";
import { requireAccount } from "@/lib/server/account";
import { getDashboardSnapshot } from "@/lib/server/dashboard-queries";
import { listVendorsByAccount } from "@/lib/server/vendors";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const account = await requireAccount();
  if (!account.onboarded_at) redirect("/onboarding/profile");
  const [data, vendorRows] = await Promise.all([
    getDashboardSnapshot(account.id),
    listVendorsByAccount(account.id),
  ]);

  const initialVendors = vendorRows.map((row) => {
    const profile = data.vendors.find((v) => v.id === row.id);
    return {
      id: row.id,
      vendor_name: row.vendor_name,
      vendor_domain: row.vendor_domain,
      vendor_category: row.vendor_category,
      relationship_owner: row.relationship_owner ?? "",
      region: row.region ?? "",
      monitoring_priority: row.monitoring_priority,
      risk_tier_override: row.risk_tier_override,
      next_research_date: row.next_research_date,
      score: profile?.score ?? null,
      risk_level: profile?.riskLevel ?? null,
      pending: profile?.pending ?? true,
    };
  });

  return (
    <DashboardShell
      section="portfolio"
      title="Portfolio"
      subtitle="Add or remove vendors, queue research runs, and manage monitor coverage."
      lastUpdated={data.lastUpdated}
      account={{ displayName: account.display_name, email: account.email }}
    >
      <PortfolioTableManager initialVendors={initialVendors} />
    </DashboardShell>
  );
}
