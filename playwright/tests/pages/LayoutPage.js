// --------------------------
// PAGE OBJECT: Layout (Sidebar, Header, Theme)
// --------------------------
import { expect } from "@playwright/test";

export class LayoutPage {
  constructor(page) {
    this.page = page;

    // Sidebar
    this.sidebar = page.locator("nav, [class*='sidebar']");
    this.sidebarCollapseButton = page.getByRole("button", { name: /collapse/i });
    this.sidebarExpandButton = page.getByRole("button", { name: /expand/i });
    this.navItems = page.locator("nav a, nav button");

    // Header
    this.header = page.locator("header");
    this.pageTitle = page.locator("h1");
    this.pageSubtitle = page.locator("p").first();
    this.searchButton = page.getByRole("button", { name: /search/i });

    // Company selector
    this.companySelector = page.getByRole("combobox").first();
    this.companyOption = (name) => page.getByRole("option", { name });

    // Theme
    this.themeToggle = page.getByRole("button", { name: /theme/i });
    this.themeOption = (name) => page.getByRole("menuitem", { name });

    // Profile menu — button shows username in accessible name
    this.profileButton = page.getByRole("button", { name: /admin@popularcert\.com/i });
    this.apiDocsLink = page.getByRole("menuitem", { name: /api docs/i });
    this.allLogsLink = page.getByRole("menuitem", { name: /all logs/i });
    this.signOutLink = page.getByRole("menuitem", { name: /sign out/i });

    // Command palette
    this.commandPalette = page.getByRole("dialog");
    this.commandPaletteInput = page.getByPlaceholder(/search.*pages/i);
  }

  // Navigate to a page via sidebar
  async navigateTo(pageName) {
    await this.page.getByRole("link", { name: new RegExp(pageName, "i") }).click();
    await this.page.waitForLoadState("networkidle");
  }

  // Collapse sidebar
  async collapseSidebar() {
    await this.sidebarCollapseButton.click();
  }

  // Expand sidebar
  async expandSidebar() {
    await this.sidebarExpandButton.click();
  }

  // Select company
  async selectCompany(name) {
    await this.companySelector.click();
    await this.page.getByRole("option", { name }).click();
  }

  // Toggle theme
  async setTheme(theme) {
    await this.themeToggle.click();
    await this.page.getByRole("menuitem", { name: new RegExp(theme, "i") }).click();
  }

  // Open command palette
  async openCommandPalette() {
    await this.page.keyboard.press("Control+k");
    await expect(this.commandPalette).toBeVisible();
  }

  // Search in command palette
  async searchCommandPalette(query) {
    await this.commandPaletteInput.fill(query);
  }

  // Select command palette item
  async selectCommandPaletteItem(name) {
    await this.page.getByRole("option", { name }).click();
  }

  // Close command palette
  async closeCommandPalette() {
    await this.page.keyboard.press("Escape");
  }

  // Get page title
  async getPageTitle() {
    return await this.pageTitle.textContent();
  }

  // Verify page title
  async expectPageTitle(title) {
    await expect(this.pageTitle).toContainText(title);
  }

  // Click profile menu
  async openProfileMenu() {
    await this.profileButton.click();
  }

  // Sign out
  async signOut() {
    await this.openProfileMenu();
    await this.signOutLink.click();
  }
}
