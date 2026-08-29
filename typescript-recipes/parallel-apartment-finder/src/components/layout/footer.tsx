"use client"

import { Z, FONT_MONO } from "@/lib/palette"

// The brand credit is a real link to parallel.ai (official symbol + mono
// label), shown on every view.
export function Footer() {
  return (
    <footer className="max-w-6xl mx-auto px-6 py-10">
      <a
        href="https://parallel.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] hover:underline"
        style={{ color: Z.textMid, fontFamily: FONT_MONO, fontWeight: 500 }}
      >
        <img src="/parallel-symbol.svg" alt="" width={13} height={13} style={{ display: "block" }} />
        Powered by Parallel · parallel.ai
      </a>
    </footer>
  )
}
