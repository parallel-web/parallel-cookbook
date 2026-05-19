"use client";

import { useState } from "react";

export function SignInForm({ defaultEmail }: { defaultEmail: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), apiKey: apiKey.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        next?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Sign-in failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      window.location.href = json.next ?? "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setSubmitting(false);
    }
  }

  return (
    <form className="signin-form" onSubmit={onSubmit}>
      <label className="signin-field">
        <span>Work email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          disabled={submitting}
        />
      </label>
      <label className="signin-field">
        <span>Parallel API key</span>
        <input
          type="password"
          required
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="paste your key (starts with parallel-...)"
          disabled={submitting}
        />
      </label>
      {error ? (
        <div className="signin-error" role="alert">
          {error}
        </div>
      ) : null}
      <button type="submit" className="signin-cta" disabled={submitting || !email || !apiKey}>
        {submitting ? "Validating..." : "Continue with this key"}
      </button>
    </form>
  );
}
