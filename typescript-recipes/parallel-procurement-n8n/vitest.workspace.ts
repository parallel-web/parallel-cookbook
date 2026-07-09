import { defineConfig } from "vitest/config";
import path from "path";

// Two test projects share one runner:
//
//   - `src`        — existing src/ tests, alias @ → src/ (the legacy default).
//   - `dashboard`  — new dashboard tests under tests/dashboard/, with @ →
//                    dashboard/ so the same Next.js path mapping the runtime
//                    code uses works without rewriting imports.
//
// We also stub the Next.js `server-only` import for the dashboard project so
// dashboard-side modules can be imported by the Node test runner.
export default defineConfig({
  test: {
    projects: [
      {
        extends: "./vitest.config.ts",
        test: {
          name: "src",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/dashboard/**"],
        },
      },
      {
        test: {
          name: "dashboard",
          globals: true,
          environment: "node",
          include: ["tests/dashboard/**/*.test.ts"],
        },
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./dashboard"),
            "server-only": path.resolve(__dirname, "./tests/fixtures/server-only-stub.ts"),
            // The dashboard route handlers `import { NextResponse, NextRequest }
            // from "next/server"`. In tests we substitute a minimal stub so we
            // don't need Next.js's runtime in the Node test graph.
            "next/server": path.resolve(__dirname, "./tests/fixtures/next-server-stub.ts"),
          },
        },
      },
    ],
  },
});
