"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { Z, FONT_HEADING, FONT_BODY, FONT_MONO } from "@/lib/palette"
import type { AppConfig } from "@/types"

// Plain building blocks. Deliberately minimal styling: this page is meant to
// read like a short engineering write-up, not a landing page.

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: FONT_HEADING, fontSize: "1.35rem", fontWeight: 500, color: Z.text, marginTop: "2.75rem", marginBottom: "0.75rem" }}>
      {children}
    </h2>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: Z.textSoft, lineHeight: 1.7, margin: "0 0 1rem", fontSize: "1rem" }}>{children}</p>
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ backgroundColor: Z.bgSubtle, color: Z.text, padding: "1px 5px", borderRadius: 4, fontSize: "0.88em", fontFamily: FONT_MONO }}>
      {children}
    </code>
  )
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre style={{
      backgroundColor: Z.bgCard, border: `1px solid ${Z.border}`, borderRadius: 8,
      padding: "14px 16px", overflowX: "auto", fontSize: 12.5, lineHeight: 1.6,
      color: Z.textSoft, fontFamily: FONT_MONO, margin: "0 0 1.25rem",
    }}>
      {children}
    </pre>
  )
}

const FINDALL_BODY = `POST /v1beta/findall/runs

{
  "objective": "Find 2 bedroom apartments for rent under
                4600 dollars per month in San Francisco, CA",
  "entity_type": "apartment rental listings",
  "match_conditions": [
    { "name": "is_rental_listing",
      "description": "One individual unit's listing page with
                      its own street address. Not a search or
                      category page." },
    { "name": "fits_budget",
      "description": "Asking rent <= $4600. If no rent shown,
                      treat as matched." }
  ],
  "enrichments": [
    { "name": "monthly_rent_usd", "description": "..." },
    { "name": "bedrooms",         "description": "..." },
    { "name": "street_address",   "description": "..." }
    // 15 more: bathrooms, sqft, pet_policy, parking, ...
  ],
  "generator": "base",
  "match_limit": 10
}`

const PIPELINE = `1.  POST /api/search              create the FindAll run
2.  GET  /api/search/{id}         poll: status + matched candidates
3.  POST /api/search/{id}/enrich  run the 18-field enrichment
4.  GET  /api/search/{id}         poll until enrichment settles
5.  GET  /api/search/{id}/finalize  geocode + score, return listings`

const TASK_BODY = `POST /v1/tasks/runs

{
  "input": { "title": "...", "body": "...", "price": 2200,
             "address": "...", "source": "craigslist.org" },
  "task_spec": { "output_schema": { "type": "json",
                 "json_schema": { /* 5 fact-based scam signals */ } } },
  "processor": "base"
}`

function ConfigTable() {
  const [config, setConfig] = useState<AppConfig | null>(null)

  useEffect(() => {
    let alive = true
    fetch(api("/api/config"))
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (alive) setConfig(c) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!config) return <P>Loading live configuration...</P>

  const rows: [string, string, string][] = [
    ["Default city", config.cityShort, "CITY_SHORT"],
    ["Default budget", `$${config.defaultBudget.toLocaleString()}/mo`, "SEARCH_BUDGET"],
    ["FindAll generator", "base", "FINDALL_GENERATOR"],
    ["Match limit", "10", "FINDALL_MATCH_LIMIT"],
    ["Reference point", config.referencePoint.name, "REFERENCE_POINT_*"],
    ["Aggregator stale after", `${config.staleness.aggregatorDays} days`, "STALE_AGGREGATOR_DAYS"],
    ["Direct source stale after", `${config.staleness.directDays} days`, "STALE_DIRECT_DAYS"],
  ]

  return (
    <div style={{ overflowX: "auto", margin: "0 0 1.25rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <tbody>
          {rows.map(([label, value, env]) => (
            <tr key={label} style={{ borderTop: `1px solid ${Z.border}` }}>
              <td style={{ padding: "8px 12px 8px 0", color: Z.text, fontWeight: 600 }}>{label}</td>
              <td style={{ padding: "8px 12px", color: Z.textSoft, fontFamily: FONT_MONO, fontSize: 13 }}>{value}</td>
              <td style={{ padding: "8px 0", textAlign: "right" }}><Code>{env}</Code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function DocsPage() {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: Z.bgPage, color: Z.text, fontFamily: FONT_BODY }}>
      <header style={{ borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <img src="/parallel-lockup.svg" alt="Parallel" style={{ height: 20, width: "auto", display: "block" }} />
            <span className="hidden sm:inline" style={{ fontSize: 12, fontWeight: 500, color: Z.textMid, fontFamily: FONT_MONO, textTransform: "uppercase", letterSpacing: "0.06em" }}>How this was built</span>
          </div>
          <a href="/" style={{ fontSize: 13, fontWeight: 600, color: Z.blueDark, textDecoration: "none", whiteSpace: "nowrap" }}>back to search</a>
        </div>
      </header>

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 96px" }}>
        <h1 style={{ fontFamily: FONT_HEADING, fontSize: "2rem", fontWeight: 500, letterSpacing: "-0.02em", margin: "0 0 1rem" }}>
          How this was built
        </h1>
        <P>
          This is a Bay Area apartment finder built on Parallel&apos;s FindAll and Task APIs. You describe a place
          in plain language and get back individual listings you can actually open, each checked against your
          criteria. The whole thing is one Next.js app on Vercel. There is no backend server and no database.
        </P>

        <H2>One FindAll call does the hard part</H2>
        <P>
          A search does not send a keyword query. It sends an objective plus a few match conditions, and FindAll
          discovers candidates across the web and checks each one. The parts that matter:
          {" "}<strong style={{ color: Z.text }}>match conditions</strong> decide whether a candidate is kept (booleans like
          &quot;is this one real listing?&quot; and &quot;is it under budget?&quot;), and{" "}
          <strong style={{ color: Z.text }}>enrichments</strong> are the 18 structured fields pulled back for each match
          (rent, beds, address, and so on). Enrichments run on the Task API, one task per match.
        </P>
        <Pre>{FINDALL_BODY}</Pre>
        <P>
          Bedroom count is intentionally not a match condition. Strict conditions cause zero-match runs when the
          API cannot verify them from page text, so beds come back as an enrichment and get filtered in code.
        </P>

        <H2>The app is a stateless client driving the run</H2>
        <P>
          FindAll runs are asynchronous, so the browser drives each search through short serverless calls. The
          server holds no state between them. The only thing that persists is the user&apos;s saved shortlist, kept
          in their own browser via <Code>localStorage</Code>.
        </P>
        <Pre>{PIPELINE}</Pre>

        <H2>Verified does not mean openable</H2>
        <P>
          This was the part that took the most work. FindAll verifying a candidate means the page matched the
          conditions. It does not guarantee a link a person can click and rent from. The gap between those two is
          most of the application:
        </P>
        <P>
          Category and search pages match &quot;describes rentals&quot; but you cannot rent them, so the match condition
          rejects index pages and a URL guard filters search or category paths. A few aggregators
          ({" "}<Code>zillow.com</Code>, <Code>yelp.com</Code>, <Code>loopnet.com</Code>, <Code>crexi.com</Code>)
          bot-wall the real listing, so they are blocked rather than sending someone to a dead link. And when a
          candidate carries several URLs, the app picks the most specific individual one instead of a browse page.
        </P>

        <H2>Discovery is variable, so plan for thin runs</H2>
        <P>
          A thin query sometimes comes back mostly category pages and finalizes near-empty, while the same query a
          minute later returns six. Two guards handle it. If discovery never fills its match limit (a rare or
          over-constrained query), the app proceeds to enrichment once it has run long enough with at least one
          match, rather than waiting forever. And if a run that actually completed still finalizes with almost
          nothing, it runs one more fresh pass and keeps whichever found more.
        </P>
        <P>
          Discovery plus per-listing enrichment is inherently a multi-minute operation, so the UI shows a timer and
          streams results in as they verify. <Code>generator: base</Code> is the right tier for a broad
          city-wide query; <Code>core</Code> and <Code>pro</Code> search harder for rarer, more specific ones.
        </P>

        <H2>A second, targeted check with the Task API</H2>
        <P>
          For listings from untrusted sources, a fraud check runs on the Task API directly (the same API that
          powers the enrichments). The schema asks for concrete signals rather than a vague &quot;is this a scam&quot;
          score, and the signals are weighted in code.
        </P>
        <Pre>{TASK_BODY}</Pre>

        <H2>Scoring</H2>
        <P>
          Each listing gets a 0 to 100 score from price fit and proximity to a reference point (with a bedroom-fit
          penalty used only for ranking). Because results are fetched fresh on every search, staleness is handled
          separately: listings the API reports inactive, or past a freshness window, are flagged and hidden by
          default.
        </P>

        <H2>Live configuration</H2>
        <P>Everything is env-driven. These are the values this instance is running with right now:</P>
        <ConfigTable />

        <footer style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: `1px solid ${Z.border}`, fontSize: 13, color: Z.textFaint }}>
          Powered by Parallel Web Systems. <a href="https://parallel.ai" style={{ color: Z.blueDark, textDecoration: "none" }}>parallel.ai</a>
        </footer>
      </main>
    </div>
  )
}
