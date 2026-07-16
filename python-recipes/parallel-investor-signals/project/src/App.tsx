import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { CustomFieldResult, Depth, ResearchBrief } from "./types";
import { ApiError, enrichCompany } from "./lib/api";
import { MOCK_BRIEF } from "./lib/mock";
import { getCached, recentQueries, saveCached } from "./lib/cache";
import {
  deleteProfile,
  findProfile,
  listProfiles,
  saveProfile,
  type SavedProfile,
} from "./lib/profiles";
import { useTheme } from "./lib/useTheme";
import { clearAccessKey, getAccessKey } from "./lib/auth";
import { PasswordGate } from "./components/PasswordGate";
import { Header, SHOW_SIGNALS, type Mode } from "./components/Header";
import { EnrichSearchBar } from "./components/EnrichSearchBar";
import { AskBar } from "./components/AskBar";
import { BriefHeader } from "./components/BriefHeader";
import { AccountCard } from "./components/AccountCard";
import { ContactsTable } from "./components/ContactsTable";
import { HomePage } from "./components/HomePage";
import { EmptyState, ErrorState } from "./components/States";

// Code-split the secondary views: most sessions never open Bulk or Signals,
// so they load on demand instead of padding the main bundle.
const BulkPanel = lazy(() =>
  import("./components/BulkPanel").then((m) => ({ default: m.BulkPanel })),
);
const SignalsPanel = lazy(() =>
  import("./components/SignalsPanel").then((m) => ({ default: m.SignalsPanel })),
);
import { LiveResearchState } from "./components/LiveResearchState";
import { SourceDrawer } from "./components/SourceDrawer";
import { SourceDrawerContext, type SourceRequest } from "./components/SourceDrawerContext";

export default function App() {
  const { theme, toggle } = useTheme();
  // Demo access gate: a stored key means previously unlocked. The backend is
  // the enforcement point — a stale/rotated key just 401s and re-gates below.
  const [authed, setAuthed] = useState<boolean>(() => Boolean(getAccessKey()));
  // Land on the dashboard: saved profiles are the daily entry point.
  const [mode, setMode] = useState<Mode>("home");

  // Saved company profiles (localStorage; the Home dashboard's data).
  const [profiles, setProfiles] = useState<SavedProfile[]>(() => listProfiles());

  // Single-lookup state
  const [depth, setDepth] = useState<Depth>("fast");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  // When the shown brief came from the session cache or a saved profile, this
  // is its saved-at time (used for the honest "cached · Xm ago" badge).
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const [recents, setRecents] = useState(() => recentQueries());

  // Source drawer (lifted to the root; opened from anywhere via context)
  const [source, setSource] = useState<SourceRequest | null>(null);

  // Whether the on-screen brief has a saved profile (kept in sync on changes).
  const briefSaved = brief
    ? profiles.some((p) => p.query === brief.query.trim().toLowerCase())
    : false;

  // If this company is saved, push the latest brief into its profile.
  const syncProfile = useCallback((b: ResearchBrief) => {
    if (findProfile(b.query)) {
      saveProfile(b);
      setProfiles(listProfiles());
    }
  }, []);

  // Dev/design aid: ?mock=1 renders a canned brief instantly (clearly not a
  // live run — meta.run_ids are trun_mock_*). Never used in the normal flow.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mock") === "1") {
      setBrief(MOCK_BRIEF);
      setLastQuery(MOCK_BRIEF.query);
      setQuery(MOCK_BRIEF.query);
      setMode("single");
    }
  }, []);


  const runEnrich = useCallback(
    async (query: string, opts?: { force?: boolean }) => {
      setLastQuery(query);
      setQuery(query); // keep the search input in sync (chips, retry, refresh)
      setError(null);

      // Session cache: instant re-show during a call (unless a live refresh
      // was requested). Cached results are labeled as such — never passed off
      // as a fresh run.
      if (!opts?.force) {
        const hit = getCached(query, depth);
        if (hit) {
          setBrief(hit.brief);
          setCachedAt(hit.savedAt);
          return;
        }
      }

      setLoading(true);
      setBrief(null);
      setCachedAt(null);
      try {
        const result = await enrichCompany(query, depth);
        setBrief(result);
        saveCached(query, depth, result);
        syncProfile(result); // saved company? keep its profile fresh
        setRecents(recentQueries());
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // Key was rotated/invalid: drop it and fall back to the gate.
          clearAccessKey();
          setAuthed(false);
        } else if (e instanceof ApiError) {
          setError({ message: e.message, hint: e.hint });
        } else {
          setError({ message: "Something went wrong reaching the enrichment service." });
        }
      } finally {
        setLoading(false);
      }
    },
    [depth, syncProfile],
  );

  // Deep link: ?q=<company|domain> auto-runs a lookup once unlocked — this is
  // what the Slack "Enrich →" buttons open. Runs at most once.
  const deepLinkRan = useRef(false);
  useEffect(() => {
    if (!authed || deepLinkRan.current) return;
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q.trim()) {
      deepLinkRan.current = true;
      setMode("single");
      runEnrich(q.trim());
    }
  }, [authed, runEnrich]);

  // "Add to profile" from the ask bar: append the cited answer to the brief's
  // Custom Research card (deduped by question) and persist wherever it lives.
  const addToProfile = useCallback(
    (result: CustomFieldResult) => {
      if (!brief) return;
      const norm = (s: string) => s.trim().toLowerCase();
      const existing = brief.custom_fields ?? [];
      if (existing.some((c) => norm(c.question) === norm(result.question))) return;
      const next = { ...brief, custom_fields: [...existing, result] };
      setBrief(next);
      saveCached(next.query, depth, next);
      syncProfile(next);
    },
    [brief, depth, syncProfile],
  );

  // --- Home dashboard handlers ---
  const openProfile = useCallback((p: SavedProfile) => {
    setBrief(p.brief);
    setQuery(p.brief.query);
    setLastQuery(p.brief.query);
    setCachedAt(p.updatedAt);
    setError(null);
    setMode("single");
  }, []);

  const handleDeleteProfile = useCallback((id: string) => {
    setProfiles(deleteProfile(id));
  }, []);

  const handleNewProfile = useCallback(() => {
    setBrief(null);
    setQuery("");
    setLastQuery("");
    setCachedAt(null);
    setError(null);
    setMode("single");
  }, []);

  const handleSaveProfile = useCallback(() => {
    if (!brief) return;
    saveProfile(brief);
    setProfiles(listProfiles());
  }, [brief]);

  // "/" focuses the search input from anywhere (unless already typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      document.getElementById("enrich-input")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Everything (including ?mock=1) sits behind the gate.
  if (!authed) {
    return <PasswordGate theme={theme} onUnlock={() => setAuthed(true)} />;
  }

  return (
    <SourceDrawerContext.Provider value={{ open: setSource }}>
      <div className="min-h-screen bg-bg text-ink">
        <Header
          theme={theme}
          onToggleTheme={toggle}
          mode={mode}
          onModeChange={(m) => {
            if (m === "home") setProfiles(listProfiles());
            setMode(m);
          }}
        />

        <main className="mx-auto max-w-6xl px-5 pb-24 pt-6">
          {mode === "home" && (
            <HomePage
              profiles={profiles}
              onOpen={openProfile}
              onDelete={handleDeleteProfile}
              onNew={handleNewProfile}
            />
          )}

          {mode === "single" && (
            <>
              <EnrichSearchBar
                query={query}
                onQueryChange={setQuery}
                onSubmit={runEnrich}
                loading={loading}
                depth={depth}
                onDepthChange={setDepth}
              />

              {/* Recent lookups — cached, so tapping one is instant */}
              {!loading && recents.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-muted/70">
                    Recent
                  </span>
                  {recents.map((r) => (
                    <button
                      key={`${r.query}|${r.depth}`}
                      onClick={() => runEnrich(r.query)}
                      className="rounded-brand border border-line px-2 py-0.5 font-mono text-[12px] text-muted transition-colors hover:border-accent hover:text-accent"
                    >
                      {r.query}
                    </button>
                  ))}
                </div>
              )}

              {loading && <LiveResearchState query={lastQuery} depth={depth} />}
              {!loading && error && (
                <ErrorState
                  message={error.message}
                  hint={error.hint}
                  onRetry={() => lastQuery && runEnrich(lastQuery, { force: true })}
                />
              )}
              {!loading && !error && !brief && <EmptyState onPick={runEnrich} />}
              {!loading && !error && brief && (
                <div className="reveal">
                  <BriefHeader
                    brief={brief}
                    cachedAt={cachedAt}
                    onRefresh={() => runEnrich(brief.query, { force: true })}
                    saved={briefSaved}
                    onSave={handleSaveProfile}
                  />
                  <AskBar brief={brief} depth={depth} onAddToProfile={addToProfile} />
                  <div className="mt-4">
                    <AccountCard brief={brief} />
                  </div>
                  <div className="mt-6">
                    <h2 className="mb-3 font-mono text-[12px] uppercase tracking-wide text-muted">
                      Decision-makers
                    </h2>
                    <ContactsTable contacts={brief.contacts} />
                  </div>
                </div>
              )}
            </>
          )}

          {mode === "bulk" && (
            <Suspense fallback={<div className="parallel-card mt-6 px-5 py-8 font-mono text-[13px] text-muted">Loading…</div>}>
              <BulkPanel depth={depth} />
            </Suspense>
          )}

          {mode === "signals" && SHOW_SIGNALS && (
            <Suspense fallback={<div className="parallel-card mt-6 px-5 py-8 font-mono text-[13px] text-muted">Loading…</div>}>
            <SignalsPanel
              onEnrich={(company) => {
                // Hand a signal straight to the single-lookup flow — the
                // signal→brief pipeline in one click.
                setMode("single");
                runEnrich(company);
              }}
            />
            </Suspense>
          )}
        </main>

        <SourceDrawer request={source} onClose={() => setSource(null)} />
      </div>
    </SourceDrawerContext.Provider>
  );
}
