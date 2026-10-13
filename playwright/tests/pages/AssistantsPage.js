// --------------------------
// PAGE OBJECT: Assistants Page
// --------------------------
import { expect } from "@playwright/test";

export class AssistantsPage {
  constructor(page) {
    this.page = page;

    // Locators
    this.createButton = page.getByRole("button", { name: /create/i }).first();
    this.emptyState = page.getByText(/no assistants/i);
    this.pageHeading = page.locator("h1").first();
    this.companySelectButton = page.getByRole("button", { name: /select a workspace|no company/i });

    // Modal locators
    this.modal = page.getByRole("dialog");
    this.nameInput = page.getByLabel(/name/i);
    this.modelSelect = page.getByLabel(/model/i);
    this.promptInput = page.getByLabel(/system prompt/i);
    this.temperatureInput = page.getByLabel(/temperature/i);
    this.maxTokensInput = page.getByLabel(/max tokens/i);
    this.kbSelect = page.getByLabel(/knowledge base/i);
    this.saveButton = page.getByRole("button", { name: /save/i });
    this.cancelButton = page.getByRole("button", { name: /cancel/i });
  }

  // Navigate to Assistants and select company
  async goto() {
    await this.page.goto("/#assistants");
    await this.page.waitForLoadState("networkidle");
    await this.ensureCompanySelected();
  }

  // Ensure a company is selected
  async ensureCompanySelected() {
    if (await this.companySelectButton.isVisible().catch(() => false)) {
      const text = await this.companySelectButton.textContent().catch(() => "");
      if (text.includes("No company")) {
        await this.companySelectButton.click();
        await this.page.waitForTimeout(500);
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

  // Click create assistant
  async clickCreate() {
    await this.createButton.click();
    await this.page.waitForTimeout(500);
  }

  // Fill assistant form
  async fillForm({ name, model, prompt, temperature, maxTokens, kb }) {
    if (name) await this.nameInput.fill(name);
    if (model) await this.modelSelect.selectOption(model);
    if (prompt) await this.promptInput.fill(prompt);
    if (temperature) await this.temperatureInput.fill(String(temperature));
    if (maxTokens) await this.maxTokensInput.fill(String(maxTokens));
    if (kb) await this.kbSelect.selectOption(kb);
  }

  // Save assistant
  async save() {
    await this.saveButton.click();
    await this.page.waitForTimeout(1000);
  }

  // Cancel
  async cancel() {
    await this.cancelButton.click();
    await this.page.waitForTimeout(500);
  }

  // Click on assistant
  async clickAssistant(name) {
    await this.page.getByText(name).first().click();
  }

  // Verify assistant exists
  async expectAssistantExists(name) {
    await expect(this.page.getByText(name).first()).toBeVisible({ timeout: 10000 });
  }

  // Verify assistant not exists
  async expectAssistantNotExists(name) {
    await expect(this.page.getByText(name).first()).not.toBeVisible();
  }
}
