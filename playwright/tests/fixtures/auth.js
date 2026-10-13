// --------------------------
// FIXTURE: Authentication
// Reusable login state for all tests
// --------------------------
import { test as base } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage.js";

// Default credentials
const DEFAULT_EMAIL = "admin@popularcert.com";
const DEFAULT_PASSWORD = "admin123";

/**
 * Custom test fixture that provides authenticated page state.
 * All tests that use `test` from this file will be logged in automatically.
 */
export const test = base.extend({
  // Authenticated page
  authenticatedPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(DEFAULT_EMAIL, DEFAULT_PASSWORD);
    // After login, wait for the dashboard to render (h1 element)
    await page.waitForSelector("h1", { timeout: 15000 });
    await use(page);
  },

  // Login page
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await use(loginPage);
  },
});

export { expect } from "@playwright/test";
