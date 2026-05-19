"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, KeyRound, Mail, MessageSquare, Plus, RefreshCw, Trash2, XCircle, Zap } from "lucide-react";

type Provider = "parallel" | "slack" | "email";

interface Integration {
  id: string;
  provider: Provider;
  label: string;
  metadata: Record<string, unknown>;
  status: "active" | "revoked" | "failed";
  is_default: boolean;
  secret_hash: string;
  last_used_at: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  created_at: string;
}

const PROVIDER_META: Record<
  Provider,
  { label: string; placeholder: string; secretLabel: string; helper: string; icon: React.ComponentType<{ size?: number }> }
> = {
  parallel: {
    label: "Parallel",
    placeholder: "parallel-...",
    secretLabel: "API key",
    helper:
      "Used for deep research, monitor deployment, and webhook callbacks. Required for the dashboard to work.",
    icon: Zap,
  },
  slack: {
    label: "Slack",
    placeholder: "xoxb-...",
    secretLabel: "Bot token",
    helper:
      "Bot token from your Slack app (chat:write scope). Used to post HIGH and CRITICAL alerts to a channel of your choice.",
    icon: MessageSquare,
  },
  email: {
    label: "Email (Resend)",
    placeholder: "re_...",
    secretLabel: "Resend API key",
    helper:
      "Resend API key. We send HIGH and CRITICAL email alerts to the address on your account from a verified Resend sender.",
    icon: Mail,
  },
};

export function IntegrationsManager({
  initialIntegrations,
  accountEmail,
}: {
  initialIntegrations: Integration[];
  accountEmail: string | null;
}) {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"add" | "test" | "rotate" | "delete" | null>(null);

  const grouped = useMemo(() => groupByProvider(integrations), [integrations]);

  async function refresh() {
    const res = await fetch("/api/integrations");
    const json = (await res.json().catch(() => ({}))) as { integrations?: Integration[] };
    if (json.integrations) setIntegrations(json.integrations);
  }

  async function addIntegration(provider: Provider, secret: string, metadata: Record<string, unknown>) {
    setBusyAction("add");
    setBusyId(provider);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, secret, metadata }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Add failed (${res.status})`);
      await refresh();
    } finally {
      setBusyAction(null);
      setBusyId(null);
    }
  }

  async function testIntegration(id: string, mode: "validate" | "send") {
    setBusyAction("test");
    setBusyId(id);
    try {
      const res = await fetch(`/api/integrations/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; detail?: string };
      await refresh();
      if (!res.ok || !json.ok) {
        alert(json.error ?? `Test failed (${res.status})`);
      } else if (json.detail) {
        alert(json.detail);
      } else {
        alert(mode === "send" ? "Test message sent." : "Validation passed.");
      }
    } finally {
      setBusyAction(null);
      setBusyId(null);
    }
  }

  async function rotateIntegration(id: string, secret: string) {
    setBusyAction("rotate");
    setBusyId(id);
    try {
      const res = await fetch(`/api/integrations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `Rotate failed (${res.status})`);
      await refresh();
    } finally {
      setBusyAction(null);
      setBusyId(null);
    }
  }

  async function removeIntegration(id: string) {
    if (!confirm("Delete this integration? Anything that depended on it will stop working immediately.")) return;
    setBusyAction("delete");
    setBusyId(id);
    try {
      const res = await fetch(`/api/integrations/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `Delete failed (${res.status})`);
      }
      await refresh();
    } finally {
      setBusyAction(null);
      setBusyId(null);
    }
  }

  return (
    <div className="settings-keys">
      {(["parallel", "slack", "email"] as Provider[]).map((provider) => {
        const meta = PROVIDER_META[provider];
        const list = grouped[provider] ?? [];
        return (
          <section key={provider} className="integration-card">
            <header>
              <div className="integration-card-title">
                <meta.icon size={18} />
                <h2>{meta.label}</h2>
                {list.length > 0 ? <span className="badge-on">Connected</span> : <span className="badge-off">Not connected</span>}
              </div>
              <p>{meta.helper}</p>
            </header>

            {list.length > 0 ? (
              <ul className="integration-list">
                {list.map((it) => (
                  <li key={it.id}>
                    <div className="integration-row-main">
                      <KeyRound size={14} />
                      <div>
                        <div className="integration-label">
                          {it.label}
                          {it.is_default ? <span className="badge-default">default</span> : null}
                        </div>
                        <div className="integration-meta">
                          Hash <code>{it.secret_hash.slice(0, 12)}…</code> · added{" "}
                          {formatDate(it.created_at)}
                          {it.last_used_at ? ` · last used ${formatDate(it.last_used_at)}` : ""}
                        </div>
                        {it.last_test_at ? (
                          <div className={`integration-test ${it.last_test_ok ? "ok" : "fail"}`}>
                            {it.last_test_ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                            {it.last_test_ok
                              ? `Healthy as of ${formatDate(it.last_test_at)}`
                              : `Last test failed: ${it.last_test_error ?? "unknown error"}`}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="integration-row-actions">
                      <button type="button" disabled={busyId === it.id} onClick={() => testIntegration(it.id, "validate")}>
                        Validate
                      </button>
                      {provider !== "parallel" ? (
                        <button type="button" disabled={busyId === it.id} onClick={() => testIntegration(it.id, "send")}>
                          Send test
                        </button>
                      ) : null}
                      <button type="button" disabled={busyId === it.id} onClick={() => promptRotate(it, rotateIntegration)}>
                        <RefreshCw size={12} /> Rotate
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busyId === it.id}
                        onClick={() => removeIntegration(it.id)}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <AddIntegrationForm
              provider={provider}
              busy={busyAction === "add" && busyId === provider}
              onSubmit={addIntegration}
              accountEmail={accountEmail}
            />
          </section>
        );
      })}
    </div>
  );
}

function AddIntegrationForm({
  provider,
  busy,
  onSubmit,
  accountEmail,
}: {
  provider: Provider;
  busy: boolean;
  onSubmit: (provider: Provider, secret: string, metadata: Record<string, unknown>) => Promise<void>;
  accountEmail: string | null;
}) {
  const [secret, setSecret] = useState("");
  const [channel, setChannel] = useState("#alerts");
  const [from, setFrom] = useState(accountEmail ? `Procurement Risk <${accountEmail}>` : "Procurement Risk <onboarding@resend.dev>");

  const meta = PROVIDER_META[provider];

  async function handle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const metadata: Record<string, unknown> = {};
    if (provider === "slack") metadata.channel = channel.trim() || "#alerts";
    if (provider === "email") metadata.from = from.trim() || "Procurement Risk <onboarding@resend.dev>";
    try {
      await onSubmit(provider, secret.trim(), metadata);
      setSecret("");
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form className="integration-add" onSubmit={handle}>
      <label>
        <span>{meta.secretLabel}</span>
        <input
          type="password"
          required
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={meta.placeholder}
          disabled={busy}
        />
      </label>
      {provider === "slack" ? (
        <label>
          <span>Channel</span>
          <input
            type="text"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="#alerts"
            disabled={busy}
          />
        </label>
      ) : null}
      {provider === "email" ? (
        <label>
          <span>From address</span>
          <input
            type="text"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="Procurement Risk <alerts@yourdomain.com>"
            disabled={busy}
          />
        </label>
      ) : null}
      <button type="submit" disabled={busy || !secret.trim()}>
        <Plus size={12} />
        {busy ? "Validating..." : "Add and validate"}
      </button>
    </form>
  );
}

async function promptRotate(integration: Integration, rotate: (id: string, secret: string) => Promise<void>) {
  const next = window.prompt(`Paste a new ${PROVIDER_META[integration.provider].secretLabel} for "${integration.label}":`);
  if (!next || !next.trim()) return;
  try {
    await rotate(integration.id, next.trim());
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
}

function groupByProvider(list: Integration[]): Record<Provider, Integration[]> {
  const out: Record<Provider, Integration[]> = { parallel: [], slack: [], email: [] };
  for (const it of list) {
    if (it.provider in out) out[it.provider].push(it);
  }
  return out;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
