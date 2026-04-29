import { expect, test, type Page } from "@playwright/test";

function collectUnexpectedBrowserErrors(page: Page) {
  const errors: string[] = [];

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  return () => expect(errors).toEqual([]);
}

test("dashboard loads from the mocked live snapshot and navigates primary surfaces", async ({ page }) => {
  const assertNoBrowserErrors = collectUnexpectedBrowserErrors(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vendor intelligence overview" })).toBeVisible();
  await expect(page.getByText("GlobalTech Solutions").first()).toBeVisible();
  await expect(page.getByText("Portfolio risk posture")).toBeVisible();

  await page.getByRole("link", { name: "Attention", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Immediate attention queue" })).toBeVisible();
  await expect(page.getByText("Validate breach scope")).toBeVisible();

  await page.getByRole("link", { name: "Portfolio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();

  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Feed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download feed package" })).toBeEnabled();
  await page.getByRole("button", { name: "Share to Slack" }).click();

  await page.getByRole("link", { name: "Observe", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Observe" })).toBeVisible();
  await expect(page.getByText("Topology size")).toBeVisible();

  await page.goto("/vendors/globaltech-solutions");
  await expect(page.getByRole("heading", { name: "GlobalTech Solutions" })).toBeVisible();
  await expect(page.getByText("Recommendation")).toBeVisible();

  assertNoBrowserErrors();
});

test("portfolio manager adds, persists, and resets vendors", async ({ page }) => {
  const assertNoBrowserErrors = collectUnexpectedBrowserErrors(page);

  await page.goto("/portfolio");
  await page.getByRole("button", { name: /manage vendors/i }).click();
  await page.getByRole("button", { name: "Add vendor" }).click();

  await page.getByPlaceholder("Vendor name").fill("Atlas Components");
  await page.getByPlaceholder("Domain").fill("atlas-components.example");
  await page.getByPlaceholder("Category").fill("manufacturing");
  await page.getByPlaceholder("Owner").fill("Casey Lee");
  await page.getByPlaceholder("Region").fill("North America");
  await page.locator("select").first().selectOption("high");
  await page.locator("select").nth(1).selectOption("HIGH");
  await page.getByPlaceholder("Score").fill("82");
  await page.locator('input[type="date"]').fill("2026-05-01");
  await page.getByRole("button", { name: "Save vendor" }).click();

  await expect(page.getByText("Atlas Components")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Atlas Components")).toBeVisible();

  await page.getByRole("button", { name: /manage vendors/i }).click();
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Atlas Components")).toHaveCount(0);

  assertNoBrowserErrors();
});

test("feed and observe controls respond", async ({ page }) => {
  const assertNoBrowserErrors = collectUnexpectedBrowserErrors(page);

  await page.goto("/feed");
  await page.getByRole("button", { name: "Download feed package" }).click();
  await page.getByRole("button", { name: "Share to Slack" }).click();
  await expect(page.getByText("UI-only preview")).toBeVisible();

  await page.goto("/observe");
  await page.getByRole("button", { name: "Snapshot" }).first().click();
  await expect(page.getByText("Full topology snapshot view.")).toBeVisible();
  await page.getByRole("button", { name: "Replay" }).first().click();
  await page.getByRole("button", { name: "Play replay" }).first().click();
  await expect(page.getByRole("button", { name: "Pause replay" }).first()).toBeVisible();

  assertNoBrowserErrors();
});

test("mock snapshot endpoint satisfies the dashboard API contract", async ({ request }) => {
  const response = await request.get("http://127.0.0.1:4111/snapshot");
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.lastUpdated).toEqual(expect.any(String));
  expect(body.metrics).toEqual(expect.any(Array));
  expect(body.riskDistribution).toEqual(expect.any(Array));
  expect(body.researchSummary.totalDue).toEqual(expect.any(Number));
  expect(body.health.totalMonitors).toEqual(expect.any(Number));
  expect(body.feed[0]).toEqual(expect.objectContaining({ vendorName: expect.any(String), severity: expect.any(String) }));
  expect(body.actionQueue[0]).toEqual(expect.objectContaining({ vendorName: expect.any(String), riskLevel: expect.any(String) }));
  expect(body.vendors[0]).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      vendorName: expect.any(String),
      riskLevel: expect.any(String),
      dimensions: expect.any(Array),
      monitors: expect.any(Array),
    }),
  );
});
