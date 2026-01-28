"use client";

import { useEffect, useState } from "react";
import { supabase, Company, ENRICHMENT_FIELDS } from "@/lib/supabase";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  processing: "bg-blue-100 text-blue-800",
  failed: "bg-red-100 text-red-800",
  pending: "bg-gray-100 text-gray-800",
};

const POLL_INTERVAL_MS = 10000;

function Spinner(): JSX.Element {
  return (
    <svg className="animate-spin h-3 w-3 mr-1" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export default function Home(): JSX.Element {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyName, setCompanyName] = useState("Parallel Web Systems");
  const [website, setWebsite] = useState("parallel.ai");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadCompanies();

    // Subscribe to real-time changes
    const channel = supabase
      .channel("companies-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "companies" },
        () => loadCompanies()
      )
      .subscribe();

    // Poll for long-running tasks
    const pollInterval = setInterval(() => {
      fetch("/api/poll", { method: "POST" }).catch((err) =>
        console.error("Poll error:", err)
      );
    }, POLL_INTERVAL_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, []);

  async function loadCompanies(): Promise<void> {
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading companies:", error);
      return;
    }
    setCompanies(data || []);
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!companyName.trim() || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const { data: company, error: insertError } = await supabase
        .from("companies")
        .insert({
          company_name: companyName.trim(),
          website: website.trim() || null,
          enrichment_status: "pending",
          enriched_data: {},
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Trigger enrichment via API route (server-side secret key)
      fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: company.id }),
      }).catch((err) => console.error("Enrichment error:", err));

      setCompanyName("");
      setWebsite("");
    } catch (error) {
      console.error("Submit error:", error);
      alert("Failed to add company");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) {
      console.error("Delete error:", error);
      alert("Failed to delete");
    }
  }

  async function handleRetry(id: string): Promise<void> {
    await supabase
      .from("companies")
      .update({
        enrichment_status: "pending",
        enrichment_error: null,
        parallel_run_id: null,
        enriched_data: {},
      })
      .eq("id", id);

    fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: id }),
    }).catch((err) => console.error("Retry error:", err));
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Company Enrichment
          </h1>
          <p className="text-gray-600">
            Enter a company name to enrich it with data from the web using
            Parallel API
          </p>
        </div>

        {/* Input Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow p-6 mb-8"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="company"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Company Name *
              </label>
              <input
                id="company"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g., Stripe"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label
                htmlFor="website"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Website (optional)
              </label>
              <input
                id="website"
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="e.g., stripe.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={isSubmitting || !companyName.trim()}
                className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition"
              >
                {isSubmitting ? "Adding..." : "Enrich"}
              </button>
            </div>
          </div>
        </form>

        {/* Results Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              Enriched Companies
            </h2>
          </div>

          {companies.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              No companies yet. Add one above to get started!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Company
                    </th>
                    {ENRICHMENT_FIELDS.map((field) => (
                      <th
                        key={field.key}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {field.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {companies.map((company) => (
                    <tr key={company.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <div className="font-medium text-gray-900">
                          {company.company_name}
                        </div>
                        {company.website && (
                          <div className="text-sm text-gray-500 truncate max-w-[150px]">
                            {company.website}
                          </div>
                        )}
                      </td>
                      {ENRICHMENT_FIELDS.map((field) => (
                        <td
                          key={field.key}
                          className="px-4 py-4 text-sm text-gray-600"
                        >
                          {String(company.enriched_data?.[field.key] || "-")}
                        </td>
                      ))}
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                            STATUS_COLORS[company.enrichment_status] ||
                            STATUS_COLORS.pending
                          }`}
                        >
                          {company.enrichment_status === "processing" && (
                            <Spinner />
                          )}
                          {company.enrichment_status}
                        </span>
                        {company.enrichment_error && (
                          <p
                            className="text-xs text-red-600 mt-1 truncate max-w-[100px]"
                            title={company.enrichment_error}
                          >
                            {company.enrichment_error}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex gap-2">
                          {(company.enrichment_status === "failed" ||
                            company.enrichment_status === "completed") && (
                            <button
                              onClick={() => handleRetry(company.id)}
                              className="text-blue-600 hover:text-blue-800 text-sm"
                              title="Re-enrich"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(company.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                            title="Delete"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          Powered by{" "}
          <a
            href="https://parallel.ai"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Parallel
          </a>{" "}
          +{" "}
          <a
            href="https://supabase.com"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Supabase
          </a>
        </div>
      </div>
    </main>
  );
}
