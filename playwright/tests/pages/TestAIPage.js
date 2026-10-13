// --------------------------
// PAGE OBJECT: Test AI (Ask Console)
// --------------------------
import { expect } from "@playwright/test";

export class TestAIPage {
  constructor(page) {
    this.page = page;

    // Locators
    this.messageInput = page.getByPlaceholder(/ask.*question/i);
    this.sendButton = page.getByRole("button", { name: /send/i });
    this.clearButton = page.getByRole("button", { name: /clear/i });
    this.responseArea = page.locator("[class*='response'], [class*='message']");
    this.sourcesPanel = page.getByText(/sources/i);
    this.thinkingIndicator = page.getByText(/thinking/i);
    this.assistantSelect = page.getByLabel(/assistant/i);
    this.errorAlert = page.locator("[role='alert']");
  }

  // Navigate to Test AI
  async goto() {
    await this.page.goto("/#ask");
    await this.page.waitForLoadState("networkidle");
  }

  // Verify page is visible
  async expectVisible() {
    await expect(this.messageInput).toBeVisible();
  }

  // Send a question
  async askQuestion(question) {
    await this.messageInput.fill(question);
    await this.sendButton.click();
  }

  // Wait for response
  async waitForResponse(timeout = 30000) {
    await this.page.waitForSelector("[class*='response'], [class*='message']", {
      timeout,
    });
  }

  // Get response text
  async getResponseText() {
    const response = this.responseArea.last();
    return await response.textContent();
  }

  // Verify response contains text
  async expectResponseContains(text) {
    await expect(this.responseArea.last()).toContainText(text, {
      timeout: 30000,
    });
  }

  // Verify sources are shown
  async expectSourcesVisible() {
    await expect(this.sourcesPanel).toBeVisible();
  }

  // Clear conversation
  async clearConversation() {
    await this.clearButton.click();
  }

  // Select assistant
  async selectAssistant(name) {
    await this.assistantSelect.selectOption(name);
  }

  // Verify error
  async expectError(message) {
    await expect(this.errorAlert).toBeVisible();
    if (message) {
      await expect(this.errorAlert).toContainText(message);
    }
  }
}
