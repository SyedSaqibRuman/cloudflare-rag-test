// --------------------------
// PAGE OBJECT: Login Page
// --------------------------
import { expect } from "@playwright/test";

export class LoginPage {
  constructor(page) {
    this.page = page;

    // Locators
    this.usernameInput = page.getByLabel("Username");
    this.passwordInput = page.locator("input[name='password']");
    this.signInButton = page.getByRole("button", { name: /sign in/i });
    this.errorMessage = page.locator("[role='alert']");
    this.title = page.getByText("PopularCert AI");
    this.tagline = page.getByText("Build AI assistants that answer questions");
  }

  // Navigate to login page
  async goto() {
    await this.page.goto("/");
    await this.page.waitForLoadState("networkidle");
  }

  // Login with credentials
  async login(username, password) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }

  // Verify login page is visible
  async expectVisible() {
    await expect(this.title).toBeVisible();
    await expect(this.tagline).toBeVisible();
    await expect(this.signInButton).toBeVisible();
  }

  // Verify error message
  async expectError(message) {
    await expect(this.errorMessage).toBeVisible();
    if (message) {
      await expect(this.errorMessage).toContainText(message);
    }
  }

  // Verify redirect to dashboard (app renders dashboard at current URL after login)
  async expectRedirectToDashboard() {
    // After login, the app renders the dashboard layout
    await this.page.waitForSelector("h1", { timeout: 10000 });
  }
}
