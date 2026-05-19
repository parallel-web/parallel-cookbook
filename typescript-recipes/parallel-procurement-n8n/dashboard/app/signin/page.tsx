import { SignInForm } from "./SignInForm";

const ERROR_MESSAGES: Record<string, string> = {
  server_misconfigured:
    "The dashboard is missing required environment variables. Set them on Vercel and try again.",
  invalid_key: "Parallel rejected this API key. Double-check it and try again.",
  invalid_email: "Please enter a valid email address.",
  account_create_failed: "We couldn't create your account. Please try again.",
};

function describeError(reason: string | undefined): string | null {
  if (!reason) return null;
  return ERROR_MESSAGES[reason] ?? reason;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; email?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = describeError(params.error);

  return (
    <div className="signin-shell">
      <div className="signin-card">
        <div className="signin-eyebrow">Parallel Procurement</div>
        <h1 className="signin-title">Continuous vendor risk monitoring</h1>
        <p className="signin-copy">
          Bring your own keys — every API call this app makes uses credentials
          you provide. Start by pasting your Parallel API key. Slack and email
          for alerts can be added later from Settings.
        </p>

        {errorMessage ? (
          <div className="signin-error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <SignInForm defaultEmail={params.email ?? ""} />

        <p className="signin-fineprint">
          Don't have a key yet?{" "}
          <a
            href="https://platform.parallel.ai/settings?tab=api-keys"
            target="_blank"
            rel="noreferrer"
          >
            Create one in the Parallel dashboard
          </a>
          . Your key is AES-GCM encrypted at rest, never logged, and never sent
          to any third party except Parallel.
        </p>
      </div>
    </div>
  );
}
