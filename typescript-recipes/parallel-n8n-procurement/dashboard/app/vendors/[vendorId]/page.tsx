import { notFound } from "next/navigation";
import { DashboardShell, DashboardSetupState, VendorDetailPage } from "@/components/dashboard-ui";
import { loadDashboardData } from "@/lib/dashboard-data";

export default async function VendorPage({ params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  const result = await loadDashboardData();

  if (!result.ok) {
    return (
      <DashboardShell
        section="portfolio"
        title="Vendor detail"
        subtitle="Live vendor detail needs the n8n dashboard snapshot."
      >
        <DashboardSetupState message={result.message} detail={result.detail} />
      </DashboardShell>
    );
  }

  const vendor = result.data.vendors.find((entry) => entry.id === vendorId);

  if (!vendor) {
    notFound();
  }

  return (
    <DashboardShell
      data={result.data}
      section="portfolio"
      title={vendor.vendorName}
      subtitle=""
      breadcrumbItems={[{ label: "Portfolio", href: "/portfolio" }, { label: vendor.vendorName }]}
      headerMetaItems={[
        `ID: ${vendor.vendorDomain.replace(/^https?:\/\//, "").split(".")[0].toUpperCase()}`,
        `OWNER: ${vendor.relationshipOwner.toUpperCase()}`,
        `REGION: ${vendor.region.toUpperCase()}`,
        `TIER: ${vendor.monitoringPriority.toUpperCase()}`,
      ]}
    >
      <VendorDetailPage vendor={vendor} />
    </DashboardShell>
  );
}
