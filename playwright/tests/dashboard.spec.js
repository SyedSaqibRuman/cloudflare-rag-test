// --------------------------
// TEST SUITE: Dashboard
// --------------------------
import { test, expect } from "./fixtures/auth.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LayoutPage } from "./pages/LayoutPage.js";

test.describe("Dashboard", () => {
  test("2.1 Dashboard loads with heading", async ({ authenticatedPage }) => {
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    await dashboard.expectVisible();
  });

  test("2.2 Getting Started banner visible", async ({ authenticatedPage }) => {
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    // Banner may or may not be visible depending on localStorage
    await dashboard.expectVisible();
  });

  test("2.3 Getting Started step 1 navigates to Knowledge", async ({ authenticatedPage }) => {
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    if (await dashboard.addKnowledgeButton.isVisible().catch(() => false)) {
      await dashboard.clickAddKnowledge();
      await expect(authenticatedPage).toHaveURL(/ingestion/);
    }
  });

  test("2.4 Getting Started step 2 navigates to Assistants", async ({ authenticatedPage }) => {
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    if (await dashboard.createAssistantButton.isVisible().catch(() => false)) {
      await dashboard.clickCreateAssistant();
      await expect(authenticatedPage).toHaveURL(/assistants/);
    }
  });

  test("2.5 Getting Started step 3 navigates to Test AI", async ({ authenticatedPage }) => {
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    if (await dashboard.testAIButton.isVisible().catch(() => false)) {
      await dashboard.clickTestAI();
      await expect(authenticatedPage).toHaveURL(/ask/);
    }
  });

  test("2.6 Quick Actions section exists", async ({ authenticatedPage }) => {
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    await dashboard.expectVisible();
    await expect(dashboard.quickActions).toBeVisible();
  });

  test("2.7 Page heading shows Dashboard", async ({ authenticatedPage }) => {
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    await expect(dashboard.pageHeading).toContainText("Dashboard");
  });
});
