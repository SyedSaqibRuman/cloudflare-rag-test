// --------------------------
// TEST SUITE: Authentication
// --------------------------
import { test, expect } from "./fixtures/auth.js";
import { LoginPage } from "./pages/LoginPage.js";
import { LayoutPage } from "./pages/LayoutPage.js";

test.describe("Authentication", () => {
  test("1.1 Login page loads correctly", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.expectVisible();
  });

  test("1.2 Login with valid credentials", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login("admin@popularcert.com", "admin123");
    await loginPage.expectRedirectToDashboard();
  });

  test("1.3 Login with invalid password", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login("admin@popularcert.com", "wrongpass");
    await loginPage.expectError();
  });

  test("1.4 Login with empty fields", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.signInButton.click();
    // Should show validation or stay on login page
    await expect(page).not.toHaveURL(/dashboard/);
  });

  test("1.5 Login form Enter key", async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.usernameInput.fill("admin@popularcert.com");
    await loginPage.passwordInput.fill("admin123");
    await loginPage.passwordInput.press("Enter");
    await loginPage.expectRedirectToDashboard();
  });

  test("1.6 Sign out", async ({ authenticatedPage }) => {
    const layout = new LayoutPage(authenticatedPage);
    await layout.signOut();
    await expect(authenticatedPage).not.toHaveURL(/dashboard/);
  });

  test("1.7 Sign out clears session", async ({ authenticatedPage }) => {
    const layout = new LayoutPage(authenticatedPage);
    await layout.signOut();
    // After sign out, the app shows login page (regardless of URL)
    await expect(authenticatedPage.getByText("PopularCert AI")).toBeVisible();
  });
});
