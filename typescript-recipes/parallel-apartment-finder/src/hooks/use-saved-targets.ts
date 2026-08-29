"use client"

import { useState, useEffect, useCallback } from "react"
import type { Listing } from "@/types"

const STORAGE_KEY = "apartment-finder-saved-targets"

/** A listing's stable identity across searches. Per-search ids are random
 *  UUIDs, so we key saved targets by their listing URL (always present). */
function keyOf(l: Listing): string {
  return l.url || l.id
}

function loadSaved(): Listing[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    // Corrupt/unavailable storage — start empty.
  }
  return []
}

/**
 * A shortlist of apartments the user has saved, persisted in *their own
 * browser* (localStorage) — never sent to any server. This is the app's
 * only persistence: the backend stays fully stateless.
 */
export function useSavedTargets() {
  const [saved, setSaved] = useState<Listing[]>([])

  // The page is server-rendered, so reading localStorage during the first
  // render would mismatch the server HTML — hydrate after mount instead.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage hydration, not a cascading sync
    setSaved(loadSaved())
  }, [])

  const write = useCallback((next: Listing[]) => {
    setSaved(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Quota / disabled storage — in-memory state still updates.
    }
  }, [])

  const isSaved = useCallback(
    (l: Listing) => saved.some((s) => keyOf(s) === keyOf(l)),
    [saved],
  )

  const toggleSave = useCallback((l: Listing) => {
    setSaved((prev) => {
      const exists = prev.some((s) => keyOf(s) === keyOf(l))
      const next = exists ? prev.filter((s) => keyOf(s) !== keyOf(l)) : [...prev, l]
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const clearSaved = useCallback(() => write([]), [write])

  return { saved, isSaved, toggleSave, clearSaved }
}
