// --------------------------
// TEST SUITE: Responsive / Mobile
// --------------------------
import { test, expect } from "./fixtures/auth.js";
import { DashboardPage } from "./pages/DashboardPage.js";

test.describe("Responsive", () => {
  test("18.1 Mobile viewport — Dashboard loads", async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 812 });
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    await dashboard.expectVisible();
  });

  test("18.2 Mobile — no horizontal overflow", async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 812 });
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    const scrollWidth = await authenticatedPage.evaluate(() => document.body.scrollWidth);
    const innerWidth = await authenticatedPage.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 10);
  });

  test("18.3 Tablet viewport — Dashboard loads", async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 810, height: 1080 });
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    await dashboard.expectVisible();
  });

  test("18.4 Large viewport — Dashboard loads", async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 1920, height: 1080 });
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    await dashboard.expectVisible();
  });

  test("18.5 Mobile — heading visible", async ({ authenticatedPage }) => {
    await authenticatedPage.setViewportSize({ width: 375, height: 812 });
    await authenticatedPage.goto("/#dashboard");
    await authenticatedPage.waitForLoadState("networkidle");
    await expect(authenticatedPage.locator("h1").first()).toBeVisible();
  });
});
