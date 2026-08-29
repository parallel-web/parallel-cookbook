"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { AppConfig } from "@/types"

type ConfigState = {
  config: AppConfig | null
  loading: boolean
  error: string | null
}

const ConfigContext = createContext<ConfigState>({ config: null, loading: false, error: null })

export function useConfigState() {
  return useContext(ConfigContext)
}

// Config is env-derived and built on the server (lib/server/app-config.ts),
// so the layout passes it in as a prop and it's available on first render —
// no client fetch, no loading screen.
export function ConfigProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  return (
    <ConfigContext.Provider value={{ config, loading: false, error: null }}>
      {children}
    </ConfigContext.Provider>
  )
}
