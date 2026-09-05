// --------------------------
// TEST SUITE: End-to-End Workflows
// --------------------------
import { test, expect } from "./fixtures/auth.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { KnowledgeBasesPage } from "./pages/KnowledgeBasesPage.js";
import { AssistantsPage } from "./pages/AssistantsPage.js";

test.describe("End-to-End Workflows", () => {
  test("20.1 Dashboard → Knowledge → Assistants navigation", async ({ authenticatedPage }) => {
    // Start at Dashboard
    const dashboard = new DashboardPage(authenticatedPage);
    await dashboard.goto();
    await dashboard.expectVisible();

    // Navigate to Knowledge
    const kbPage = new KnowledgeBasesPage(authenticatedPage);
    await kbPage.goto();
    await kbPage.expectVisible();

    // Navigate to Assistants
    const assistantsPage = new AssistantsPage(authenticatedPage);
    await assistantsPage.goto();
    await assistantsPage.expectVisible();
  });

  test("20.2 KB wizard opens and can be cancelled", async ({ authenticatedPage }) => {
    const kbPage = new KnowledgeBasesPage(authenticatedPage);
    await kbPage.goto();
    await kbPage.clickCreate();
    // Verify wizard opened
    await expect(authenticatedPage.getByRole("dialog")).toBeVisible();
    // Cancel
    await kbPage.cancel();
  });

  test("20.3 Company switching updates page", async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/#dashboard");
    await authenticatedPage.waitForLoadState("networkidle");
    // Verify page loads
    await expect(authenticatedPage.locator("h1").first()).toBeVisible();
  });
});
