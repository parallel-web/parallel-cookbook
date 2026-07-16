// A tiny context so any FieldRow / contact cell can open the Source drawer
// without prop-drilling a handler through the whole tree. The drawer itself
// lives once at the app root (see SourceDrawer + App).
import { createContext, useContext } from "react";
import type { Citation } from "../types";

export interface SourceRequest {
  label: string; // e.g. "Funding · Last round"
  value: string; // the claimed value, shown at the top of the drawer
  citations: Citation[];
}

interface SourceDrawerCtx {
  open: (req: SourceRequest) => void;
}

export const SourceDrawerContext = createContext<SourceDrawerCtx>({
  open: () => {},
});

export function useSourceDrawer() {
  return useContext(SourceDrawerContext);
}
