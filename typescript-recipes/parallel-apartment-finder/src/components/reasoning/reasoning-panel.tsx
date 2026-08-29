"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Z, FONT_HEADING, FONT_MONO } from "@/lib/palette"
import { ProcessTimeline } from "./process-timeline"
import type { ProcessStep } from "@/types"
import type { SearchPhase } from "@/hooks/use-search"

// The timeline is driven by the run's real state (phase + live metrics), not by
// regex-scraping the log. Only the two phases that actually take time get their
// own step, each with a live subtitle so you can watch it advance:
//   discover  — FindAll searches the web and verifies candidates (the long one)
//   extract   — enrichment pulls structured fields per listing (also long)
//   finalize  — geocode + score (quick)
// The old "Verifying matches" (concurrent with discovery) and "Spam & quality
// check" (a separate, user-triggered fraud pass) were pass-through stages that
// only ever flashed green on completion, so they're gone.
const PHASE_STEP_INDEX: Record<SearchPhase["key"], number> = {
  discover: 1,
  extract: 2,
  finalize: 3,
  done: 4,
}

type Progress = { generated: number; matched: number; ready: number; total: number }

function buildSteps(
  phase: SearchPhase | null,
  progress: Progress,
  reasoning: string,
  streaming: boolean,
  done: boolean,
): ProcessStep[] {
  const steps: ProcessStep[] = [
    { id: "understand", title: "Understanding your search", status: "pending" },
    { id: "discover", title: "Searching listings across the web", status: "pending" },
    { id: "extract", title: "Extracting price, beds & details", status: "pending" },
    { id: "finalize", title: "Mapping & scoring", status: "pending" },
    { id: "ready", title: "Ready", status: "pending" },
  ]

  // How far along the run is. Understanding is instant, so once a search has
  // started (phase set) it's already at least at the discover step.
  const activeIdx = done ? 4 : phase ? PHASE_STEP_INDEX[phase.key] : 1
  for (let i = 0; i < steps.length; i++) {
    if (done || i < activeIdx) steps[i].status = "done"
    else if (i === activeIdx) steps[i].status = "active"
    else steps[i].status = "pending"
  }

  // Understanding: surface the parsed objective + constraints from the log.
  const objMatch = reasoning.match(/Objective:\s*([^\n]+)/)
  if (objMatch) steps[0].subtitle = objMatch[1].trim()
  const budgetMatch = reasoning.match(/Budget:\s*\$([\d,]+)/)
  const bedsMatch = reasoning.match(/(\d+)\+\s*beds/)
  if (budgetMatch || bedsMatch) {
    const parts: string[] = []
    if (bedsMatch) parts.push(`${bedsMatch[1]}+ beds`)
    if (budgetMatch) parts.push(`under $${budgetMatch[1]}`)
    steps[0].detail = parts.join(" · ")
  }

  // Discover: live candidate/verified counts as FindAll streams them.
  steps[1].subtitle = progress.generated > 0
    ? `${progress.generated} listing${progress.generated === 1 ? "" : "s"} found · ${progress.matched} match your criteria`
    : "Scanning listing sites across the web"

  // Extract: enrichment ripens gradually; show ready/total + a real fill bar.
  const total = progress.total || 0
  steps[2].subtitle = total > 0
    ? `${progress.ready} of ${total} listing${total === 1 ? "" : "s"} ready`
    : "Pulling structured fields from each listing page"
  if (total > 0) steps[2].progress = { matched: progress.ready, total }

  steps[3].subtitle = "Placing results on the map and scoring by fit"

  // Ready: prefer the final count the log reports; fall back to the metric.
  const doneMatch = reasoning.match(/Done\.\s*(\d+)\s*listings found/)
  if (done) {
    const n = doneMatch ? parseInt(doneMatch[1]) : progress.ready
    steps[4].subtitle = `${n} listing${n === 1 ? "" : "s"} ready for review`
  }

  // A hard failure leaves the active step mid-flight; mark it errored.
  if (/error|failed/i.test(reasoning) && !done && !streaming) {
    for (const s of steps) if (s.status === "active") s.status = "error"
  }

  return steps
}

interface ReasoningPanelProps {
  reasoning: string
  streaming: boolean
  done: boolean
  phase: SearchPhase | null
  progress: Progress
}

export function ReasoningPanel({ reasoning, streaming, done, phase, progress }: ReasoningPanelProps) {
  const [showRaw, setShowRaw] = useState(false)
  const rawRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (rawRef.current) rawRef.current.scrollTop = rawRef.current.scrollHeight
  }, [reasoning, showRaw])

  const steps = useMemo(
    () => buildSteps(phase, progress, reasoning, streaming, done),
    [phase, progress, reasoning, streaming, done],
  )
  const hasActivity = streaming || reasoning.length > 0 || done

  return (
    <aside
      className="rounded-2xl overflow-hidden sticky top-4 self-start"
      style={{ backgroundColor: Z.bgCard, border: `1px solid ${Z.border}` }}
    >
      <header
        className="flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: Z.borderSoft, backgroundColor: Z.blueSofter }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: Z.blue }}
          >
            <SparkleIcon />
          </div>
          <div className="leading-tight">
            <div className="text-xs font-bold" style={{ color: Z.text, fontFamily: FONT_HEADING }}>
              AI Assistant
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] font-bold" style={{ color: Z.textFaint }}>
              Process
            </div>
          </div>
        </div>
        {streaming && (
          <span className="text-[11px] font-bold flex items-center gap-1.5" style={{ color: Z.blue }}>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: Z.blue }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: Z.blue }} />
            </span>
            running
          </span>
        )}
        {!streaming && done && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: Z.greenSoft, color: Z.green }}>
            complete
          </span>
        )}
      </header>

      {hasActivity ? (
        <ProcessTimeline steps={steps} streaming={streaming} />
      ) : (
        <div className="px-5 py-8 text-[13px] text-center" style={{ color: Z.textFaint }}>
          The assistant&apos;s process will appear here when you run a search.
        </div>
      )}

      {hasActivity && reasoning.length > 0 && (
        <div className="border-t" style={{ borderColor: Z.borderSoft }}>
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="w-full px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-left transition-colors hover:bg-gray-50"
            style={{ color: Z.textFaint }}
          >
            {showRaw ? "▾ Hide raw log" : "▸ Show raw log"}
          </button>
          {showRaw && (
            <div
              ref={rawRef}
              className="text-[12px] whitespace-pre-wrap max-h-[280px] overflow-y-auto leading-relaxed px-5 pb-4 border-t"
              style={{ color: Z.textSoft, fontFamily: FONT_MONO, borderColor: Z.borderSoft }}
            >
              {reasoning}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function SparkleIcon({ size = 14, color = "white" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 2 14 9 21 11 14 13 12 20 10 13 3 11 10 9z" />
    </svg>
  )
}
