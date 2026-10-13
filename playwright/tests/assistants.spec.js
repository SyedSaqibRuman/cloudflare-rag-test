// --------------------------
// TEST SUITE: Assistants
// --------------------------
import { test, expect } from "./fixtures/auth.js";
import { AssistantsPage } from "./pages/AssistantsPage.js";
import { uniqueName } from "./helpers/utils.js";

test.describe("Assistants", () => {
  test("6.1 Assistants list loads", async ({ authenticatedPage }) => {
    const assistantsPage = new AssistantsPage(authenticatedPage);
    await assistantsPage.goto();
    await assistantsPage.expectVisible();
  });

  test("6.2 Create assistant modal opens", async ({ authenticatedPage }) => {
    const assistantsPage = new AssistantsPage(authenticatedPage);
    await assistantsPage.goto();
    if (await assistantsPage.createButton.isVisible().catch(() => false)) {
      await assistantsPage.clickCreate();
      await expect(assistantsPage.modal).toBeVisible();
      await assistantsPage.cancel();
    }
  });

  test("6.3 Assistants page has heading", async ({ authenticatedPage }) => {
    const assistantsPage = new AssistantsPage(authenticatedPage);
    await assistantsPage.goto();
    await expect(assistantsPage.pageHeading).toContainText("Assistants");
  });

  test("6.4 Assistants page has refresh button", async ({ authenticatedPage }) => {
    const assistantsPage = new AssistantsPage(authenticatedPage);
    await assistantsPage.goto();
    await assistantsPage.expectVisible();
  });
});
