import { redirect } from "next/navigation";
import { getCurrentAccount } from "@/lib/server/account";
import { listIntegrations } from "@/lib/server/integrations";
import { IntegrationsManager } from "./IntegrationsManager";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/signin");
  if (!account.onboarded_at) redirect("/onboarding/profile");

  const integrations = await listIntegrations(account.id);

  return (
    <div className="settings-shell">
      <div className="settings-header">
        <a className="settings-back" href="/">← Back to dashboard</a>
        <h1>Settings · API keys</h1>
        <p>
          The dashboard makes every external API call using a key you provide.
          Add a Parallel key to research and monitor vendors, a Slack bot token
          to alert on HIGH and CRITICAL events, and a Resend API key for email
          alerts.
        </p>
      </div>

      <IntegrationsManager
        initialIntegrations={integrations}
        accountEmail={account.email}
      />
    </div>
  );
}
