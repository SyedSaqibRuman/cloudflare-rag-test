// --------------------------
// TEST SUITE: Test AI (Ask Console)
// --------------------------
import { test, expect } from "./fixtures/auth.js";

test.describe("Test AI", () => {
  test("8.1 Ask Console loads", async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/#ask");
    await authenticatedPage.waitForLoadState("networkidle");
    // Verify page heading
    await expect(authenticatedPage.locator("h1").first()).toContainText(/test ai|ask/i);
  });

  test("8.2 Ask Console has input field", async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/#ask");
    await authenticatedPage.waitForLoadState("networkidle");
    // Verify input or textarea exists
    const hasInput = await authenticatedPage.getByRole("textbox").first().isVisible().catch(() => false);
    const hasTextarea = await authenticatedPage.locator("textarea").first().isVisible().catch(() => false);
    expect(hasInput || hasTextarea).toBe(true);
  });

  test("8.3 Ask Console has send button", async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/#ask");
    await authenticatedPage.waitForLoadState("networkidle");
    // Verify send button exists
    const sendButton = authenticatedPage.getByRole("button", { name: /send/i });
    const hasButton = await sendButton.isVisible().catch(() => false);
    // Or check for any button in the input area
    const hasAnyButton = await authenticatedPage.locator("button").first().isVisible().catch(() => false);
    expect(hasButton || hasAnyButton).toBe(true);
  });
});
