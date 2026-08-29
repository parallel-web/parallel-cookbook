"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { api } from "@/lib/api"
import type { Listing } from "@/types"

export type SearchPhase = { key: "discover" | "extract" | "finalize" | "done"; detail: string }

type PollResponse = {
  state: string
  generated: number
  matched: number
  rentPopulated: number
  candidateCount: number
  listings: Listing[]
}

const POLL_MS = 4000
const MAX_POLLS = 90 // ~6 min hard safety cap
// Enrichment is the slow phase (a Task per listing) and ripens gradually. With
// a large match pool, waiting for EVERY candidate to enrich is what pushed a
// full search to ~5 min. We now finalize once ENRICH_ENOUGH listings have
// enriched rent (a full page's worth survives filtering), rather than waiting
// for the whole batch — the tail candidates rarely change the shown results.
// ENRICH_MAX_WAIT_MS remains a last-resort escape hatch for a hung straggler.
const ENRICH_ENOUGH = 8
const ENRICH_MAX_WAIT_MS = 120_000
// FindAll only reports `completed` once it fills match_limit OR exhausts the
// web. A rare/over-constrained query (e.g. "3BR penthouse under $2500") may
// never fill the limit, so it never completes — the client would then poll to
// MAX_POLLS and show a timeout error, discarding the candidates it DID find.
// Once discovery has run this long with at least one match, proceed to
// enrichment with what we have instead of waiting for `completed`.
const DISCOVER_MAX_WAIT_MS = 60_000
// Start enrichment as soon as discovery has this many verified matches, rather
// than waiting for the full match_limit pool — the extra tail candidates mostly
// don't change the shown page and just add latency.
const DISCOVER_ENOUGH = 15
// For a run that escaped discovery (never `completed`), we can't use the run
// state to tell that enrichment finished. Instead finalize once enrichment has
// settled — no newly-populated rent for this long — so we don't sit on the
// full ENRICH_MAX_WAIT_MS for a small candidate set that's already done.
const ENRICH_SETTLE_MS = 15_000
// Discovery is run-to-run variable: a thin neighborhood occasionally returns a
// junk-heavy candidate set and finalizes near-empty. Rather than give up, run
// one fresh FindAll pass before showing the user (near-)nothing.
const LOW_YIELD_RETRY_THRESHOLD = 2
const VERIFY_POLL_MS = 5000
const VERIFY_MAX_POLLS = 24 // ~2 min per listing

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Task-API fraud check: verify each flagged listing's fact-based scam
// signals and fold the verdict back into the rendered cards.
async function verifyListings(
  all: Listing[],
  live: () => boolean,
  say: (text: string) => void,
  setListings: React.Dispatch<React.SetStateAction<Listing[]>>,
) {
  const targets = all.filter((l) => l.needs_verification)
  if (!targets.length) return
  say(`\nFraud check: verifying ${targets.length} untrusted-source listing${targets.length === 1 ? "" : "s"} via Task API…\n`)

  await Promise.all(targets.map(async (l) => {
    try {
      const { runId } = await fetchJson<{ runId: string }>(api("/api/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: l.title, body: l.body, price: l.price, address: l.address, source: l.source,
        }),
      })
      for (let i = 0; i < VERIFY_MAX_POLLS; i++) {
        await sleep(VERIFY_POLL_MS)
        if (!live()) return
        const v = await fetchJson<{ done: boolean; spamScore?: number; flags?: string[] }>(
          api(`/api/verify/${runId}`),
        ).catch(() => null)
        if (!v) continue
        if (!v.done) continue
        const score = v.spamScore ?? 0
        const flags = v.flags ?? []
        if (!live()) return
        setListings((prev) => prev.map((x) =>
          x.id === l.id ? { ...x, spam_score: score, spam_flags: flags, needs_verification: false } : x,
        ))
        if (score > 0) {
          say(`  ⚠ ${l.address ?? l.title ?? "listing"} · spam:${score} (${flags.join(", ")})\n`)
        }
        return
      }
    } catch {
      // Verification is best-effort; the card simply keeps spam_score 0.
    }
  }))
  if (live()) say("Fraud check complete.\n")
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const j = await res.json().catch(() => ({} as { detail?: string }))
    throw new Error((j as { detail?: string }).detail ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// Serverless-friendly search: create a FindAll run, then drive it from the
// client — poll discovery, kick enrichment, poll again, finalize (geocode +
// score). The server holds no state; this hook owns the whole lifecycle.
export function useSearch() {
  const [query, setQuery] = useState("")
  const [reasoning, setReasoning] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [listings, setListings] = useState<Listing[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [phase, setPhase] = useState<SearchPhase | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  // Live run metrics for the discovery visualization: candidates generated,
  // verified matches, enriched-and-ready, and total candidates.
  const [progress, setProgress] = useState({ generated: 0, matched: 0, ready: 0, total: 0 })
  const [fraudChecking, setFraudChecking] = useState(false)
  // Bumped on every new search and on unmount so an abandoned loop exits.
  const genRef = useRef(0)
  // Mirror of `listings` so runFraudCheck can read the current set without
  // re-creating its callback on every update.
  const listingsRef = useRef<Listing[]>([])
  useEffect(() => { listingsRef.current = listings }, [listings])

  const startSearch = useCallback(async (
    q: string,
    budget: number,
    opts: { city?: string; requirements?: string; neighborhoods?: string[]; sources?: string[] } = {},
  ) => {
    if (!q.trim()) return
    const gen = ++genRef.current
    const live = () => genRef.current === gen

    setReasoning("")
    setListings([])
    setError(null)
    setDone(false)
    setStreaming(true)
    setPhase({ key: "discover", detail: "Starting…" })
    setStartedAt(Date.now())
    setProgress({ generated: 0, matched: 0, ready: 0, total: 0 })

    const say = (text: string) => { if (live()) setReasoning((p) => p + text) }
    const fail = (msg: string) => {
      if (!live()) return
      setStreaming(false)
      setError(msg)
    }

    // One full discovery → enrich → finalize pass against a fresh FindAll run.
    // Returns the finalized listings, or null if the run hard-failed or timed
    // out (fail() has already surfaced the error). The terminal "done" state is
    // set by the caller so a thin first pass can be retried transparently.
    const driveRun = async (attempt: number): Promise<{ listings: Listing[]; completed: boolean } | null> => {
      // 1) Create the run (each attempt is a brand-new FindAll run).
      const body: Record<string, unknown> = { query: q, budget }
      if (opts.city) body.city = opts.city
      if (opts.requirements) body.requirements = opts.requirements
      if (opts.neighborhoods?.length) body.neighborhoods = opts.neighborhoods
      if (opts.sources?.length) body.sources = opts.sources
      const created = await fetchJson<{ runId: string; objective: string; minBeds: number | null; maxBeds: number | null }>(
        api("/api/search"),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      )
      if (!live()) return null
      const { runId, objective, minBeds, maxBeds } = created

      if (attempt === 1) {
        say(`Objective: ${objective}\n`)
        say(`Budget: $${budget.toLocaleString()}/mo`)
        if (minBeds) say(` · ${minBeds}+ beds`)
      }
      say(`\n\nStarting entity discovery…\nRun: ${runId}\nSearching and verifying candidates…\n\n`)

      // City rides along on every poll/finalize call so the stateless server
      // can score with the right per-city floors and proximity anchor.
      // (Sources are an include hint applied only at create time.)
      const cityParam = opts.city ? `&city=${encodeURIComponent(opts.city)}` : ""
      const maxBedsParam = maxBeds != null ? `&maxBeds=${maxBeds}` : ""
      const pollUrl = api(
        `/api/search/${runId}?budget=${budget}${minBeds ? `&minBeds=${minBeds}` : ""}${cityParam}${maxBedsParam}`,
      )

      // 2) Drive the run: discover → enrich → extract → finalize.
      let enrichStarted = false
      let enrichStartedAt = 0
      let prevGenerated = -1
      let prevMatched = -1
      let prevReady = -1
      let discoverCompleted = false
      let lastReadyChangeAt = 0
      const discoverStartedAt = Date.now()
      const seenIds = new Set<string>()

      // Add newly verified listings to the UI in live time; enrichment
      // updates existing cards in place (ids are stable listing URLs).
      const mergeIncoming = (incoming: Listing[]) => {
        for (const l of incoming) {
          if (!seenIds.has(l.id)) {
            seenIds.add(l.id)
            say(`  + verified: ${l.address ?? l.title ?? l.url}\n`)
          }
        }
        setListings((prev) => {
          const byId = new Map(prev.map((x) => [x.id, x]))
          const merged = [...prev]
          for (const l of incoming) {
            const existing = byId.get(l.id)
            if (!existing) {
              merged.push(l)
            } else {
              const idx = merged.findIndex((x) => x.id === l.id)
              // Keep client-side fields (coords, spam verdicts) if already set.
              merged[idx] = {
                ...existing, ...l,
                lat: existing.lat ?? l.lat,
                lng: existing.lng ?? l.lng,
                spam_score: existing.spam_score || l.spam_score,
                spam_flags: existing.spam_flags ?? l.spam_flags,
              }
            }
          }
          return merged
        })
      }

      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS)
        if (!live()) return null

        let poll: PollResponse
        try {
          poll = await fetchJson<PollResponse>(pollUrl)
        } catch {
          continue // transient poll failure — try again next tick
        }
        if (!live()) return null

        // Terminal failure from the search provider (e.g. FindAll run errored
        // or was cancelled). Surface it immediately instead of polling until
        // the timeout — otherwise the UI just spins for minutes.
        if (poll.state === "failed" || poll.state === "cancelled" || poll.state === "error") {
          fail("The search service hit an error on this run (it may be rate-limited or over quota). Please try again in a bit.")
          return null
        }

        if (poll.listings.length) mergeIncoming(poll.listings)

        setProgress({
          generated: poll.generated,
          matched: poll.matched,
          ready: poll.rentPopulated,
          total: poll.candidateCount,
        })

        if (!enrichStarted) {
          if (poll.generated !== prevGenerated || poll.matched !== prevMatched) {
            say(`Progress: ${poll.generated} found, ${poll.matched} verified\n`)
            setPhase({
              key: "discover",
              detail: `Verifying candidates · ${poll.generated} found · ${poll.matched} match`,
            })
            prevGenerated = poll.generated
            prevMatched = poll.matched
          }
          // Proceed to enrichment when discovery completes, when it already has
          // a healthy set of matches (no need to wait for the full pool to
          // start extracting), OR when it has run long enough with at least one
          // match (a rare query may never fill match_limit and never report
          // `completed` — don't hang on it).
          const discoverEnough = poll.matched >= DISCOVER_ENOUGH
          const discoverTimedOut =
            Date.now() - discoverStartedAt > DISCOVER_MAX_WAIT_MS && poll.matched >= 1
          if (poll.state === "completed" || discoverEnough || discoverTimedOut) {
            if (poll.state !== "completed") {
              say(`\nProceeding with ${poll.matched} verified so far…\n`)
            } else {
              say(`\nVerified ${poll.matched}. Extracting listing details…\n`)
            }
            setPhase({ key: "extract", detail: "Extracting price, beds & address…" })
            try {
              await fetchJson(api(`/api/search/${runId}/enrich`), { method: "POST" })
            } catch (e) {
              fail(e instanceof Error ? e.message : "enrichment failed")
              return null
            }
            enrichStarted = true
            enrichStartedAt = Date.now()
            lastReadyChangeAt = Date.now()
            // Did discovery reach `completed` (filled/exhausted), or did we bail
            // out early? Drives whether a thin result is worth retrying.
            discoverCompleted = poll.state === "completed"
            await sleep(POLL_MS) // let the enrich job flip status to running
          }
          continue
        }

        // Enrichment phase: narrate fill-in progress; wait for it to complete
        // so enough listings survive filtering (finalizing at the first ready
        // listing yielded zero results). The time-based escape hatch only
        // fires if enrichment drags on with a hung straggler.
        const total = poll.candidateCount || 1
        if (poll.rentPopulated !== prevReady) {
          say(`Extracting details… ${poll.rentPopulated}/${total} ready\n`)
          setPhase({ key: "extract", detail: `Extracting details · ${poll.rentPopulated}/${total} ready` })
          prevReady = poll.rentPopulated
          lastReadyChangeAt = Date.now()
        }
        // Enough enriched to show a full page: finalize without waiting for the
        // long tail of the batch to enrich. The target scales down for a small
        // match set (don't wait for 12 when only 8 matched).
        const enrichEnough = poll.rentPopulated >= Math.min(poll.matched || poll.candidateCount || 1, ENRICH_ENOUGH)
        const enrichTimedOut = Date.now() - enrichStartedAt > ENRICH_MAX_WAIT_MS && poll.rentPopulated >= 1
        // A run that never `completed` won't ever report enrichment done via
        // state, so finalize once every candidate is populated OR enrichment
        // has settled (no new rents for ENRICH_SETTLE_MS). Only for escaped
        // runs — a normally-completing run still waits for `completed`.
        const enrichSettled = !discoverCompleted && poll.rentPopulated >= 1 &&
          (poll.rentPopulated >= poll.candidateCount ||
            Date.now() - lastReadyChangeAt > ENRICH_SETTLE_MS)
        if (poll.state !== "completed" && !enrichEnough && !enrichTimedOut && !enrichSettled) continue
        if (poll.state !== "completed") {
          say(`\nFinalizing ${poll.rentPopulated} ready now.\n`)
        }

        // 3) Finalize: geocode + score everything in one server call.
        setPhase({ key: "finalize", detail: "Mapping & scoring listings…" })
        say("\nMapping & scoring…\n")
        const fin = await fetchJson<{ listings: Listing[] }>(
          api(`/api/search/${runId}/finalize?budget=${budget}${minBeds ? `&minBeds=${minBeds}` : ""}${cityParam}${maxBedsParam}`),
        )
        if (!live()) return null

        for (const l of fin.listings) {
          const price = l.price ? `$${l.price.toLocaleString()}/mo` : "n/a"
          const bd = l.bedrooms != null ? `${l.bedrooms}bd` : "?bd"
          say(`  + ${l.address ?? "no address"} · ${bd} · ${price}\n`)
        }
        return { listings: fin.listings, completed: discoverCompleted }
      }

      fail("Search timed out. Please try again")
      return null
    }

    try {
      const first = await driveRun(1)
      if (!live()) return
      if (first === null) return // hard failure/timeout already surfaced
      let result = first.listings

      // Thin first pass: retry once with a fresh run before giving up, keeping
      // whichever pass surfaced more. Only when discovery actually COMPLETED —
      // a run that bailed early (rare/over-constrained query that never fills
      // match_limit) is legitimately near-empty, so a second pass just doubles
      // latency for the same answer.
      if (first.completed && result.length < LOW_YIELD_RETRY_THRESHOLD) {
        say(`\nOnly ${result.length} listing${result.length === 1 ? "" : "s"} so far. Retrying discovery once for more…\n`)
        setListings([])
        const retry = await driveRun(2)
        if (!live()) return
        if (retry && retry.listings.length > result.length) result = retry.listings
        // The first pass already succeeded, so a failed retry must not surface
        // an error over the usable results we do have — clear it and show them.
        setError(null)
      }

      say(`\nDone. ${result.length} listings found.\n`)
      setListings(result)
      setPhase({ key: "done", detail: `${result.length} listing${result.length === 1 ? "" : "s"} found` })
      setStreaming(false)
      setDone(true)
    } catch (err) {
      fail(err instanceof Error ? err.message : "Search failed")
    }
  }, [])

  // User-triggered second run: fraud-check the current results via the
  // Task API. Badges on the cards update live as verdicts land.
  const runFraudCheck = useCallback(async () => {
    const gen = genRef.current
    const live = () => genRef.current === gen
    const say = (text: string) => { if (live()) setReasoning((p) => p + text) }
    const targets = listingsRef.current.filter((l) => l.needs_verification)
    if (!targets.length || fraudChecking) return
    setFraudChecking(true)
    try {
      await verifyListings(listingsRef.current, live, say, setListings)
    } finally {
      if (live()) setFraudChecking(false)
    }
  }, [fraudChecking])

  // Abandon any in-flight loop when the component unmounts.
  useEffect(() => () => { genRef.current++ }, [])

  return {
    query, setQuery,
    reasoning, streaming, listings, error, done, phase, startedAt, progress,
    fraudChecking, runFraudCheck,
    startSearch, setError,
  } as const
}
