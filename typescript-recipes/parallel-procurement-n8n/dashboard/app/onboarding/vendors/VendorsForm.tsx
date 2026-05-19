"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { MonitoringPriority } from "@/lib/types/dashboard";

interface VendorEntry {
  id: string;
  vendor_name: string;
  vendor_domain: string;
  vendor_category: string;
  monitoring_priority: MonitoringPriority;
}

type Mode = "manual" | "paste" | "upload";

const DEMO_SET = `Acme Corp,acme.com,technology,high
GlobalTech Solutions,globaltech.io,technology,high
FinServ Partners,finserv.com,financial_services,medium
BluePeak Logistics,bluepeaklogistics.com,professional_services,medium
Precision Manufacturing,precisionmfg.com,manufacturing,low`;

export function VendorsForm({ initial }: { initial: VendorEntry[] }) {
  const router = useRouter();
  const [vendors, setVendors] = useState<VendorEntry[]>(initial);
  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [category, setCategory] = useState("technology");
  const [priority, setPriority] = useState<MonitoringPriority>("medium");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/vendors", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { vendors: VendorEntry[] };
    setVendors(json.vendors ?? []);
  }

  async function addManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName: name,
          vendorDomain: domain,
          vendorCategory: category,
          monitoringPriority: priority,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      setName("");
      setDomain("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function importPaste() {
    if (!pasteText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vendors/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pasteText }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      setPasteText("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadDemoSet() {
    setPasteText(DEMO_SET);
    setMode("paste");
  }

  async function uploadCsv(file: File) {
    const text = await file.text();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vendors/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (${res.status})`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeVendor(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/vendors/${id}`, { method: "DELETE" });
      setVendors((current) => current.filter((v) => v.id !== id));
    } finally {
      setBusy(false);
    }
  }

  function continueToResearch() {
    if (vendors.length === 0) {
      setError("Add at least one vendor to continue.");
      return;
    }
    router.push("/onboarding/research");
  }

  return (
    <div className="onboarding-card">
      <div className="onboarding-mode-tabs">
        <button
          type="button"
          className={`onboarding-mode-tab${mode === "manual" ? " active" : ""}`}
          onClick={() => setMode("manual")}
        >
          Add manually
        </button>
        <button
          type="button"
          className={`onboarding-mode-tab${mode === "paste" ? " active" : ""}`}
          onClick={() => setMode("paste")}
        >
          Paste list
        </button>
        <button
          type="button"
          className={`onboarding-mode-tab${mode === "upload" ? " active" : ""}`}
          onClick={() => setMode("upload")}
        >
          Upload CSV
        </button>
      </div>

      {mode === "manual" ? (
        <form className="onboarding-input-row" onSubmit={addManual}>
          <label>
            <small>Vendor name</small>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              required
            />
          </label>
          <label>
            <small>Domain</small>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="acme.com"
              required
            />
          </label>
          <label>
            <small>Category</small>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="technology"
            />
          </label>
          <label>
            <small>Monitoring priority</small>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as MonitoringPriority)}
            >
              <option value="high">High (5 monitors, daily)</option>
              <option value="medium">Medium (3 monitors, daily)</option>
              <option value="low">Low (2 monitors, weekly)</option>
            </select>
          </label>
          <div className="onboarding-actions" style={{ gridColumn: "1 / -1" }}>
            <p className="onboarding-helper">
              You can edit the priority and other fields later from the Portfolio page.
            </p>
            <button type="submit" className="onboarding-cta secondary" disabled={busy}>
              {busy ? "Adding…" : "Add vendor"}
            </button>
          </div>
        </form>
      ) : null}

      {mode === "paste" ? (
        <div>
          <textarea
            className="onboarding-textarea"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"One vendor per line: Name, domain[, category[, priority]]\n\nAcme Corp, acme.com, technology, high"}
          />
          <div className="onboarding-actions">
            <button
              type="button"
              className="onboarding-cta secondary"
              onClick={loadDemoSet}
              disabled={busy}
            >
              Load 5-vendor demo set
            </button>
            <button
              type="button"
              className="onboarding-cta"
              onClick={importPaste}
              disabled={busy || !pasteText.trim()}
            >
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "upload" ? (
        <div>
          <p className="onboarding-helper">
            CSV header row supported (columns: <code>vendorName, vendorDomain, vendorCategory, monitoringPriority</code>).
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadCsv(f);
            }}
            disabled={busy}
          />
        </div>
      ) : null}

      {error ? <div className="onboarding-error">{error}</div> : null}

      <div>
        <small className="onboarding-helper">
          {vendors.length} vendor{vendors.length === 1 ? "" : "s"} added
        </small>
        <div className="onboarding-vendor-list">
          {vendors.map((v) => (
            <div key={v.id} className="onboarding-vendor-row">
              <div>
                <strong>{v.vendor_name}</strong>
                <small>
                  {v.vendor_domain} · {v.vendor_category.replaceAll("_", " ")} ·{" "}
                  {v.monitoring_priority}
                </small>
              </div>
              <button
                type="button"
                className="delete"
                onClick={() => removeVendor(v.id)}
                aria-label={`Remove ${v.vendor_name}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="onboarding-actions">
        <a className="onboarding-cta secondary" href="/onboarding/profile">
          Back
        </a>
        <button
          type="button"
          className="onboarding-cta"
          onClick={continueToResearch}
          disabled={vendors.length === 0 || busy}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
