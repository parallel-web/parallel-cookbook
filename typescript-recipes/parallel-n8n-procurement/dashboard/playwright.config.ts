import { defineConfig, devices } from "@playwright/test";

const appPort = 3107;
const mockPort = 4111;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "node tests/e2e/mock-snapshot-server.mjs",
      url: `http://127.0.0.1:${mockPort}/health`,
      env: {
        PROCUREMENT_DASHBOARD_WRITE_TOKEN: "test-write-token",
      },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run dev -- --hostname 127.0.0.1 --port ${appPort}`,
      url: `http://127.0.0.1:${appPort}`,
      env: {
        PROCUREMENT_DASHBOARD_SNAPSHOT_URL: `http://127.0.0.1:${mockPort}/snapshot`,
        PROCUREMENT_DASHBOARD_MUTATION_URL: `http://127.0.0.1:${mockPort}/mutation`,
        PROCUREMENT_DASHBOARD_WRITE_TOKEN: "test-write-token",
      },
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
