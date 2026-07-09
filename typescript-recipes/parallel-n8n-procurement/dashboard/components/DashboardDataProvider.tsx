"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DashboardData } from "@/lib/dashboard-types";

const DashboardDataContext = createContext<DashboardData | null>(null);

export function DashboardDataProvider({ data, children }: { data: DashboardData; children: ReactNode }) {
  return <DashboardDataContext.Provider value={data}>{children}</DashboardDataContext.Provider>;
}

export function useDashboardData() {
  const data = useContext(DashboardDataContext);

  if (!data) {
    throw new Error("Dashboard data is unavailable. Render this component inside DashboardShell with live data.");
  }

  return data;
}
