// --------------------------
// PAGE OBJECT: Dashboard Page
// --------------------------
import { expect } from "@playwright/test";

export class DashboardPage {
  constructor(page) {
    this.page = page;

    // Locators
    this.gettingStartedBanner = page.getByText("Getting Started");
    this.addKnowledgeButton = page.getByRole("button", { name: /add knowledge/i });
    this.createAssistantButton = page.getByRole("button", { name: /create assistant/i });
    this.testAIButton = page.getByRole("button", { name: /test ai/i });
    this.deployChatbotButton = page.getByRole("button", { name: /deploy chatbot/i });
    this.quickActions = page.getByText("Quick Actions");
    this.pageHeading = page.locator("h1").first();
  }

  // Navigate to dashboard
  async goto() {
    await this.page.goto("/#dashboard");
    await this.page.waitForLoadState("networkidle");
  }

  // Verify dashboard is visible
  async expectVisible() {
    await expect(this.pageHeading).toBeVisible();
  }

  // Verify getting started banner
  async expectGettingStarted() {
    await expect(this.gettingStartedBanner).toBeVisible();
  }

  // Click add knowledge
  async clickAddKnowledge() {
    await this.addKnowledgeButton.click();
  }

  // Click create assistant
  async clickCreateAssistant() {
    await this.createAssistantButton.click();
  }

  // Click test AI
  async clickTestAI() {
    await this.testAIButton.click();
  }

  // Click deploy chatbot
  async clickDeployChatbot() {
    await this.deployChatbotButton.click();
  }

  // Dismiss getting started
  async dismissGettingStarted() {
    const dismissButton = this.page.getByRole("button", { name: /dismiss/i });
    if (await dismissButton.isVisible().catch(() => false)) {
      await dismissButton.click();
    }
  }
}
