import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/OnboardingShell";
import { VendorsForm } from "./VendorsForm";
import { requireAccount } from "@/lib/server/account";
import { listVendorsByAccount } from "@/lib/server/vendors";

export const dynamic = "force-dynamic";

export default async function OnboardingVendorsPage() {
  const account = await requireAccount();
  if (account.onboarded_at) redirect("/");

  const vendors = await listVendorsByAccount(account.id);
  return (
    <OnboardingShell
      step={2}
      title="Add the vendors you want to monitor"
      subtitle="We will run a deep research assessment on every vendor and deploy persistent monitors based on the priority you choose. Add at least one vendor to continue."
    >
      <VendorsForm
        initial={vendors.map((v) => ({
          id: v.id,
          vendor_name: v.vendor_name,
          vendor_domain: v.vendor_domain,
          vendor_category: v.vendor_category,
          monitoring_priority: v.monitoring_priority,
        }))}
      />
    </OnboardingShell>
  );
}
