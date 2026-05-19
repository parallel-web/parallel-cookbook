import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DashboardShell, VendorDetailPage } from "@/components/dashboard-ui";
import { VendorActions } from "@/components/VendorActions";
import { requireAccount } from "@/lib/server/account";
import { getDashboardSnapshot } from "@/lib/server/dashboard-queries";

export const dynamic = "force-dynamic";

export default async function VendorPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const account = await requireAccount();
  if (!account.onboarded_at) redirect("/onboarding/profile");

  const data = await getDashboardSnapshot(account.id);
  const vendor = data.vendors.find((v) => v.id === vendorId);
  if (!vendor) notFound();

  return (
    <DashboardShell
      section="portfolio"
      title={vendor.vendorName}
      subtitle=""
      lastUpdated={data.lastUpdated}
      account={{ displayName: account.display_name, email: account.email }}
      breadcrumb={
        <>
          <Link href="/portfolio" className="page-breadcrumb-link">
            Portfolio
          </Link>
          <span>/</span>
          <span>{vendor.vendorName}</span>
        </>
      }
      headerMeta={
        <div className="page-meta vendor-meta-bar">
          <span>
            ID: {vendor.vendorDomain.replace(/^https?:\/\//, "").split(".")[0].toUpperCase()}
          </span>
          <span>OWNER: {vendor.relationshipOwner.toUpperCase()}</span>
          <span>REGION: {vendor.region.toUpperCase()}</span>
          <span>TIER: {vendor.monitoringPriority.toUpperCase()}</span>
        </div>
      }
      aside={<VendorActions vendorId={vendor.id} hasMonitors={vendor.monitors.length > 0} />}
    >
      <VendorDetailPage vendor={vendor} />
    </DashboardShell>
  );
}
