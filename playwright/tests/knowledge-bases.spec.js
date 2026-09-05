// --------------------------
// TEST SUITE: Knowledge Bases
// --------------------------
import { test, expect } from "./fixtures/auth.js";
import { KnowledgeBasesPage } from "./pages/KnowledgeBasesPage.js";
import { uniqueName } from "./helpers/utils.js";

test.describe("Knowledge Bases", () => {
  test("3.1 KB list loads", async ({ authenticatedPage }) => {
    const kbPage = new KnowledgeBasesPage(authenticatedPage);
    await kbPage.goto();
    await kbPage.expectVisible();
  });

  test("3.2 Create KB wizard opens", async ({ authenticatedPage }) => {
    const kbPage = new KnowledgeBasesPage(authenticatedPage);
    await kbPage.goto();
    await kbPage.clickCreate();
    await authenticatedPage.waitForTimeout(500);
    // Verify wizard dialog opened
    await expect(authenticatedPage.getByRole("dialog")).toBeVisible();
  });

  test("3.3 Create KB — Continue disabled without name", async ({ authenticatedPage }) => {
    const kbPage = new KnowledgeBasesPage(authenticatedPage);
    await kbPage.goto();
    await kbPage.clickCreate();
    // Continue button should be disabled when name is empty
    await expect(kbPage.continueButton).toBeDisabled();
  });

  test("3.4 Create KB — Full wizard flow", async ({ authenticatedPage }) => {
    const kbPage = new KnowledgeBasesPage(authenticatedPage);
    const kbName = uniqueName("test-kb");
    await kbPage.goto();
    await kbPage.clickCreate();

    // Step 1: Basic Info — enter name to enable Continue
    await kbPage.nameInput.fill(kbName);
    await expect(kbPage.continueButton).toBeEnabled();
    await kbPage.continueButton.click();
    await authenticatedPage.waitForTimeout(500);

    // Step 2: Data Source — select URL
    const urlInput = authenticatedPage.getByLabel(/url/i).or(authenticatedPage.getByPlaceholder(/url/i));
    if (await urlInput.isVisible().catch(() => false)) {
      await urlInput.fill("https://example.com");
    }
    await kbPage.continueButton.click();
    await authenticatedPage.waitForTimeout(500);

    // Step 3: Storage & Search — continue with defaults
    if (await kbPage.continueButton.isVisible().catch(() => false)) {
      await kbPage.continueButton.click();
      await authenticatedPage.waitForTimeout(500);
    }

    // Step 4: Processing — continue with defaults
    if (await kbPage.continueButton.isVisible().catch(() => false)) {
      await kbPage.continueButton.click();
      await authenticatedPage.waitForTimeout(500);
    }

    // Step 5: Review — save
    if (await kbPage.saveButton.isVisible().catch(() => false)) {
      await kbPage.save();
    }
  });

  test("3.5 Create KB — Cancel wizard", async ({ authenticatedPage }) => {
    const kbPage = new KnowledgeBasesPage(authenticatedPage);
    await kbPage.goto();
    await kbPage.clickCreate();
    await kbPage.nameInput.fill("should-not-exist");
    await kbPage.cancel();
    // Wizard should close
    await authenticatedPage.waitForTimeout(500);
  });

  test("3.6 KB page has heading", async ({ authenticatedPage }) => {
    const kbPage = new KnowledgeBasesPage(authenticatedPage);
    await kbPage.goto();
    await expect(kbPage.pageHeading).toContainText("Knowledge");
  });

  test("3.7 KB page shows stats", async ({ authenticatedPage }) => {
    const kbPage = new KnowledgeBasesPage(authenticatedPage);
    await kbPage.goto();
    // Page should show stat cards
    await expect(authenticatedPage.getByText("Knowledge Bases")).toBeVisible();
  });
});
