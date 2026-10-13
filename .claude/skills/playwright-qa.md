# Skill: Playwright E2E Testing

## Purpose

Automated end-to-end testing of PopularCert AI using Playwright.

## Setup

```bash
cd playwright
npm install
npx playwright install chromium
```

## Running Tests

```bash
# All tests
cd playwright && npx playwright test

# Specific suite
cd playwright && npx playwright test auth.spec.js
cd playwright && npx playwright test dashboard.spec.js
cd playwright && npx playwright test knowledge-bases.spec.js
cd playwright && npx playwright test assistants.spec.js
cd playwright && npx playwright test test-ai.spec.js
cd playwright && npx playwright test navigation.spec.js
cd playwright && npx playwright test responsive.spec.js
cd playwright && npx playwright test e2e.spec.js

# With UI
cd playwright && npx playwright test --ui

# Headed mode (see browser)
cd playwright && npx playwright test --headed

# Debug mode
cd playwright && npx playwright test --debug

# View report
cd playwright && npx playwright show-report
```

## Test Structure

```text
playwright/
├── playwright.config.js        # Configuration
├── package.json                # Dependencies
├── tests/
│   ├── auth.spec.js            # Authentication tests
│   ├── dashboard.spec.js       # Dashboard tests
│   ├── knowledge-bases.spec.js # KB CRUD tests
│   ├── assistants.spec.js      # Assistant tests
│   ├── test-ai.spec.js         # Ask Console tests
│   ├── navigation.spec.js      # Navigation tests
│   ├── responsive.spec.js      # Mobile/responsive tests
│   ├── e2e.spec.js             # End-to-end workflows
│   ├── pages/                  # Page Object Models
│   │   ├── LoginPage.js
│   │   ├── DashboardPage.js
│   │   ├── KnowledgeBasesPage.js
│   │   ├── AssistantsPage.js
│   │   ├── ChatbotsPage.js
│   │   ├── TestAIPage.js
│   │   └── LayoutPage.js
│   ├── fixtures/               # Test fixtures
│   │   └── auth.js
│   └── helpers/                # Utility helpers
│       └── utils.js
└── playwright-report/          # Generated report
```

## Writing New Tests

### 1. Import fixtures

```javascript
import { test, expect } from "./fixtures/auth.js";
```

### 2. Use Page Objects

```javascript
import { KnowledgeBasesPage } from "./pages/KnowledgeBasesPage.js";

test("my test", async ({ authenticatedPage }) => {
  const kbPage = new KnowledgeBasesPage(authenticatedPage);
  await kbPage.goto();
  await kbPage.clickCreate();
  // ...
});
```

### 3. Use web-first assertions

```javascript
// Good
await expect(page.getByText("Success")).toBeVisible();
await expect(input).toHaveValue("expected");

// Bad
await page.waitForTimeout(5000);
const text = await page.textContent("...");
expect(text).toBe("Success");
```

### 4. Use resilient locators

```javascript
// Good
page.getByRole("button", { name: /save/i });
page.getByLabel(/email/i);
page.getByPlaceholder(/search/i);

// Bad
page.locator(".btn-primary");
page.locator("div:nth-child(3) > button");
```

## CI Integration

```yaml
# GitHub Actions example
- name: Install Playwright
  run: cd playwright && npm install && npx playwright install chromium

- name: Run E2E tests
  run: cd playwright && npx playwright test
  env:
    BASE_URL: http://localhost:3000
```
