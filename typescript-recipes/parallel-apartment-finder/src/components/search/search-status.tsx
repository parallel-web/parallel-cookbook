"use client"

import { useEffect, useState } from "react"
import { Z, FONT_HEADING, FONT_BODY } from "@/lib/palette"
import type { SearchPhase } from "@/hooks/use-search"

const STEPS: { key: SearchPhase["key"]; label: string }[] = [
  { key: "discover", label: "Searching the web" },
  { key: "extract", label: "Extracting details" },
  { key: "finalize", label: "Mapping & scoring" },
]

function fmt(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function SearchStatus({
  phase, streaming, startedAt, soundOn, onToggleSound,
}: {
  phase: SearchPhase | null
  streaming: boolean
  startedAt: number | null
  soundOn: boolean
  onToggleSound: () => void
}) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!streaming || !startedAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [streaming, startedAt])

  if (!phase) return null

  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0

  const isDone = phase.key === "done" || !streaming
  const activeIdx = STEPS.findIndex((s) => s.key === phase.key)

  return (
    <div
      className="rounded-2xl px-4 py-3 mb-4 flex items-center gap-3 flex-wrap"
      style={{
        backgroundColor: isDone ? Z.bgCard : Z.blueSoft,
        border: `1px solid ${isDone ? Z.border : Z.blueBorder}`,
      }}
    >
      {/* spinner / check */}
      {isDone ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={Z.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        // The app mark's unit grid, scanning: an orange pulse sweeps unit to
        // unit while FindAll checks candidates (see .af-scan-cell keyframes).
        <span className="grid grid-cols-3 gap-[2px] shrink-0" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className="af-scan-cell" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </span>
      )}

      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold" style={{ color: isDone ? Z.text : Z.blueDarker, fontFamily: FONT_HEADING }}>
          {phase.detail}
        </div>
        {!isDone && (
          <div className="text-[11px] mt-0.5" style={{ color: Z.textMid, fontFamily: FONT_BODY }}>
            This can take a few minutes. Results appear as they&apos;re verified.
          </div>
        )}
      </div>

      {/* step pips */}
      {!isDone && (
        <div className="hidden sm:flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              title={s.label}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === activeIdx ? 24 : 8,
                backgroundColor: i <= activeIdx ? Z.blue : Z.blueBorder,
              }}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onToggleSound}
        aria-label={soundOn ? "Mute search sound" : "Unmute search sound"}
        title={soundOn ? "Mute search sound" : "Unmute search sound"}
        className="shrink-0 rounded-md p-1 transition-colors"
        style={{ color: soundOn ? Z.blueDark : Z.textFaint }}
      >
        {soundOn ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4V5z" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" />
          </svg>
        )}
      </button>

      <span
        className="text-xs font-bold tabular-nums shrink-0"
        style={{ color: isDone ? Z.textMid : Z.blueDark, fontFamily: FONT_HEADING }}
      >
        {fmt(elapsed)}
      </span>
    </div>
  )
}
