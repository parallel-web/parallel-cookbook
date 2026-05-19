import { defineConfig } from "vitest/config";
import path from "path";

// Default project: legacy src/ tests, alias @ → src/.
// Dashboard tests live under tests/dashboard/ and are configured via
// vitest.workspace.ts so they can override @ → dashboard/ without colliding
// with the src tests.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/dashboard/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "dashboard/lib/**/*.ts", "dashboard/app/api/**/*.ts"],
      exclude: ["src/workflows/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
