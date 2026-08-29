"use client"

import { Z, FONT_HEADING } from "@/lib/palette"
import type { AppConfig } from "@/types"

function SparkleIcon({ size = 14, color = "white" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 2 14 9 21 11 14 13 12 20 10 13 3 11 10 9z" />
    </svg>
  )
}

interface HeaderProps {
  config: AppConfig
}

export function Header({ config }: HeaderProps) {
  return (
    <header
      className="sticky top-0 z-20 backdrop-blur"
      style={{ backgroundColor: "rgba(255,255,255,0.92)", borderBottom: `1px solid ${Z.border}` }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 min-w-0">
          {config.brand.logoUrl ? (
            <img src={config.brand.logoUrl} alt={config.brand.name} className="h-8 sm:h-10 w-auto" />
          ) : (
            <span
              className="text-base font-bold tracking-tight"
              style={{ color: Z.text, fontFamily: FONT_HEADING }}
            >
              {config.brand.name}
            </span>
          )}
        </div>
        <a
          href="/docs"
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors hover:brightness-95 whitespace-nowrap shrink-0"
          style={{ color: Z.blueDark, backgroundColor: Z.blueSoft, border: `1px solid ${Z.blueBorder}` }}
        >
          <SparkleIcon size={11} color={Z.blue} />
          <span className="hidden sm:inline">How this was built →</span>
          <span className="sm:hidden">How it&apos;s built →</span>
        </a>
      </div>
    </header>
  )
}
