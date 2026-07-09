import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/OnboardingShell";
import { ResearchKickoff } from "./ResearchKickoff";
import { requireAccount } from "@/lib/server/account";
import { listVendorsByAccount } from "@/lib/server/vendors";

export const dynamic = "force-dynamic";

export default async function OnboardingResearchPage() {
  const account = await requireAccount();
  if (account.onboarded_at) redirect("/");

  const vendors = await listVendorsByAccount(account.id);
  if (vendors.length === 0) redirect("/onboarding/vendors");

  return (
    <OnboardingShell
      step={3}
      title="Run your first research batch"
      subtitle="We will kick off a deep research task for every vendor in parallel and deploy continuous monitors. This typically takes 2–6 minutes; you can leave the page open or come back later."
    >
      <ResearchKickoff
        vendors={vendors.map((v) => ({
          id: v.id,
          vendor_name: v.vendor_name,
          monitoring_priority: v.monitoring_priority,
        }))}
      />
    </OnboardingShell>
  );
}
