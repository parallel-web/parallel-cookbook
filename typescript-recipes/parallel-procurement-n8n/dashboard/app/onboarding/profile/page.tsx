import { redirect } from "next/navigation";
import { OnboardingShell } from "@/components/OnboardingShell";
import { ProfileForm } from "./ProfileForm";
import { requireAccount } from "@/lib/server/account";

export const dynamic = "force-dynamic";

export default async function OnboardingProfilePage() {
  const account = await requireAccount();
  if (account.onboarded_at) redirect("/");

  return (
    <OnboardingShell
      step={1}
      title="Welcome to Parallel Procurement"
      subtitle="Tell us how to address you. We use this to label assessments, audit log entries, and any alerts that surface in the dashboard."
    >
      <ProfileForm
        initial={{
          displayName: account.display_name ?? "",
          email: account.email ?? "",
        }}
      />
    </OnboardingShell>
  );
}
