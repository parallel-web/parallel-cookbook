import type { NextConfig } from "next"

// All /api/* endpoints are native Next.js route handlers (src/app/api) that
// call the Parallel API directly — no separate backend, no proxy.
const nextConfig: NextConfig = {
  // Keep build traces scoped to this recipe when it lives inside the cookbook
  // monorepo (which contains several independent lockfiles).
  outputFileTracingRoot: process.cwd(),
}

export default nextConfig
