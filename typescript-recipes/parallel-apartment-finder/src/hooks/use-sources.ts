"use client"

import { useState, useEffect, useCallback } from "react"
import { ALL_MAJOR_DOMAINS, sanitizeDomain } from "@/lib/sources"

const STORAGE_KEY = "apartment-finder-sources"

type Stored = { selected: string[]; custom: string[] }

function load(): Stored {
  if (typeof window === "undefined") return { selected: [], custom: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { selected: [], custom: [] }
    const parsed = JSON.parse(raw) as Partial<Stored>
    const known = new Set(ALL_MAJOR_DOMAINS)
    return {
      selected: (parsed.selected ?? []).filter((d) => known.has(d)),
      custom: (parsed.custom ?? []).map((d) => sanitizeDomain(d)).filter((d): d is string => !!d),
    }
  } catch {
    return { selected: [], custom: [] }
  }
}

// Source picker state, persisted per browser. Selected majors + custom domains
// are *includes*: sites the search should be sure to cover, on top of a normal
// broad web search. Empty = no specific includes (search the whole web).
export function useSources() {
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState<string[]>([])

  // localStorage is only readable on the client, and reading it during the
  // first render would mismatch the server-rendered HTML — hydrate after mount.
  useEffect(() => {
    const s = load()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage hydration, not a cascading sync
    setSelected(s.selected)
    setCustom(s.custom)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ selected, custom }))
    } catch { /* private mode etc. — selection just won't persist */ }
  }, [selected, custom])

  const toggle = useCallback((domain: string) => {
    setSelected((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain],
    )
  }, [])

  const addCustom = useCallback((input: string): boolean => {
    const d = sanitizeDomain(input)
    if (!d) return false
    setCustom((prev) => (prev.includes(d) ? prev : [...prev, d]))
    return true
  }, [])

  const removeCustom = useCallback((domain: string) => {
    setCustom((prev) => prev.filter((d) => d !== domain))
  }, [])

  const reset = useCallback(() => {
    setSelected([])
    setCustom([])
  }, [])

  const includeSources = [...selected, ...custom]
  const hasIncludes = includeSources.length > 0

  return { selected, custom, toggle, addCustom, removeCustom, reset, hasIncludes, includeSources } as const
}
