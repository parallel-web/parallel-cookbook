"use client"

import { useEffect } from "react"
import { Z, FONT_HEADING, FONT_BODY } from "@/lib/palette"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Uncaught error:", error)
  }, [error])

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ backgroundColor: Z.bgPage, color: Z.text, fontFamily: FONT_BODY }}
    >
      <div className="max-w-md text-center">
        <div
          className="text-xs font-bold uppercase tracking-[0.16em] mb-3"
          style={{ color: Z.red }}
        >
          Something went wrong
        </div>
        <p
          className="text-base leading-relaxed mb-6"
          style={{ color: Z.textMid }}
        >
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
          style={{
            backgroundColor: Z.blue,
            color: "white",
            fontFamily: FONT_HEADING,
          }}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
