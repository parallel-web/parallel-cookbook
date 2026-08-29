"use client"

import { Z, FONT_HEADING } from "@/lib/palette"
import type { ProcessStep } from "@/types"

export function ProcessTimeline({ steps, streaming }: { steps: ProcessStep[]; streaming: boolean }) {
  return (
    <ol className="px-5 py-5 space-y-1">
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1
        const titleColor =
          s.status === "done" ? Z.text :
          s.status === "active" ? Z.text :
          s.status === "error" ? Z.red : Z.textFaint
        const lineColor = s.status === "done" ? Z.blue : Z.border
        return (
          <li key={s.id} className="flex gap-3">
            <div className="flex flex-col items-center pt-0.5">
              <StepDot status={s.status} streaming={streaming} />
              {!isLast && (
                <div
                  className="w-px flex-1 mt-1 mb-1 transition-colors duration-300"
                  style={{ backgroundColor: lineColor, minHeight: 18 }}
                />
              )}
            </div>
            <div className={`flex-1 pb-${isLast ? 0 : 3}`}>
              <div
                className="text-[13px] font-semibold leading-snug"
                style={{ color: titleColor, fontFamily: FONT_HEADING }}
              >
                {s.title}
              </div>
              {s.subtitle && (
                <div className="text-[12px] mt-0.5 leading-relaxed" style={{ color: Z.textMid }}>
                  {s.subtitle}
                </div>
              )}
              {s.detail && (
                <div className="text-[11px] mt-0.5 italic" style={{ color: Z.textFaint }}>
                  &ldquo;{s.detail}&rdquo;
                </div>
              )}
              {s.progress && s.status === "active" && (
                <ProgressMeter matched={s.progress.matched} total={s.progress.total} />
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function StepDot({ status, streaming }: { status: string; streaming: boolean }) {
  if (status === "done") {
    return (
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: Z.blue }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    )
  }
  if (status === "active") {
    return (
      <div className="relative w-5 h-5 shrink-0 flex items-center justify-center">
        {streaming && (
          <span className="absolute inset-0 rounded-full animate-ping opacity-60" style={{ backgroundColor: Z.blue }} />
        )}
        <span
          className="relative w-5 h-5 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "white", border: `2px solid ${Z.blue}` }}
        >
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: Z.blue }} />
        </span>
      </div>
    )
  }
  if (status === "error") {
    return (
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: Z.red }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round">
          <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      </div>
    )
  }
  return (
    <div
      className="w-5 h-5 rounded-full shrink-0"
      style={{ backgroundColor: Z.bgPage, border: `2px solid ${Z.border}` }}
    />
  )
}

function ProgressMeter({ matched, total }: { matched: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (matched / total) * 100) : 0
  return (
    <div className="mt-2">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: Z.bgPage }}>
        <div
          className="h-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, backgroundColor: Z.blue }}
        />
      </div>
    </div>
  )
}
