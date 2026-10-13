// --------------------------
// PAGE OBJECT: Knowledge Bases Page
// --------------------------
import { expect } from "@playwright/test";

export class KnowledgeBasesPage {
  constructor(page) {
    this.page = page;

    // Locators
    this.createButton = page.getByRole("button", { name: /\+ create kb/i });
    this.searchInput = page.getByPlaceholder(/search/i);
    this.refreshButton = page.getByRole("button", { name: /refresh/i });
    this.pageHeading = page.locator("h1").first();
    this.companySelectButton = page.getByRole("button", { name: /select a workspace|no company/i });

    // Wizard locators
    this.wizardModal = page.getByRole("dialog");
    this.nameInput = page.getByLabel(/name/i);
    this.descriptionInput = page.getByLabel(/description/i);
    this.continueButton = page.getByRole("button", { name: /continue/i });
    this.backButton = page.getByRole("button", { name: /back/i });
    this.saveButton = page.getByRole("button", { name: /create knowledge base/i });
    this.cancelButton = page.getByRole("button", { name: /cancel/i });

    // Data source options
    this.wordpressOption = page.getByText("WordPress").first();
    this.urlOption = page.getByText(/website.*url/i).or(page.getByText(/url/i)).first();
    this.fileOption = page.getByText(/file/i).first();

    // Custom limit
    this.customLimitRadio = page.getByText(/custom/i).first();
    this.limitInput = page.getByLabel(/maximum/i).or(page.getByLabel(/limit/i));
  }

  // Navigate to Knowledge Bases and select a company
  async goto() {
    await this.page.goto("/#ingestion");
    await this.page.waitForLoadState("networkidle");
    await this.ensureCompanySelected();
  }

  // Ensure a company is selected (required for KB operations)
  async ensureCompanySelected() {
    // Check if company selector button shows "No company selected"
    if (await this.companySelectButton.isVisible().catch(() => false)) {
      const text = await this.companySelectButton.textContent().catch(() => "");
      if (text.includes("No company")) {
        await this.companySelectButton.click();
        await this.page.waitForTimeout(500);
        // Select the first company from the dropdown
        const firstCompany = this.page.getByRole("option").first();
        if (await firstCompany.isVisible().catch(() => false)) {
          await firstCompany.click();
          await this.page.waitForTimeout(1000);
        }
      }
    }
  }

  // Verify page is visible
  async expectVisible() {
    await expect(this.pageHeading).toBeVisible();
  }

  // Click create KB
  async clickCreate() {
    await this.createButton.click({ timeout: 5000 });
    await this.page.waitForTimeout(500);
  }

  // Fill step 1 (Basic Info)
  async fillStep1(name, description) {
    await this.nameInput.fill(name);
    if (description) {
      await this.descriptionInput.fill(description);
    }
    await this.continueButton.click();
    await this.page.waitForTimeout(500);
  }

  // Select WordPress source
  async selectWordPress(url) {
    await this.wordpressOption.click();
    await this.page.waitForTimeout(300);
    const urlInput = this.page.getByLabel(/url/i).or(this.page.getByPlaceholder(/url/i));
    await urlInput.fill(url);
    await this.continueButton.click();
    await this.page.waitForTimeout(500);
  }

  // Select URL source
  async selectURL(url) {
    await this.urlOption.click();
    await this.page.waitForTimeout(300);
    const urlInput = this.page.getByLabel(/url/i).or(this.page.getByPlaceholder(/url/i));
    await urlInput.fill(url);
    await this.continueButton.click();
    await this.page.waitForTimeout(500);
  }

  // Set custom limit
  async setCustomLimit(limit) {
    await this.customLimitRadio.click();
    await this.limitInput.fill(String(limit));
  }

  // Continue through wizard steps
  async continueToStep(step) {
    for (let i = 0; i < step; i++) {
      await this.continueButton.click();
      await this.page.waitForTimeout(500);
    }
  }

  // Save KB
  async save() {
    await this.saveButton.click();
    await this.page.waitForTimeout(1000);
  }

  // Cancel wizard
  async cancel() {
    await this.cancelButton.click();
    await this.page.waitForTimeout(500);
  }

  // Search KBs
  async search(query) {
    await this.searchInput.fill(query);
  }

  // Click on a KB
  async clickKB(name) {
    await this.page.getByText(name).first().click();
  }

  // Verify KB exists
  async expectKBExists(name) {
    await expect(this.page.getByText(name).first()).toBeVisible({ timeout: 10000 });
  }

  // Verify KB not exists
  async expectKBNotExists(name) {
    await expect(this.page.getByText(name).first()).not.toBeVisible();
  }
}
