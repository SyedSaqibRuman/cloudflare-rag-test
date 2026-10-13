// --------------------------
// PLAYWRIGHT CONFIGURATION
// PopularCert AI — E2E Testing
// --------------------------
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for PopularCert AI Admin Portal.
 *
 * Run tests:
 *   cd playwright && npx playwright test
 *   cd playwright && npx playwright test --ui
 *   cd playwright && npx playwright show-report
 */
export default defineConfig({
  // Test directory
  testDir: "./tests",

  // Maximum time per test
  timeout: 60_000,

  // Assertions timeout
  expect: {
    timeout: 10_000,
  },

  // Run tests in parallel
  fullyParallel: false,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : 1,

  // Reporter
  reporter: [
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["list"],
  ],

  // Shared settings for all the projects below
  use: {
    // Base URL
    baseURL: process.env.BASE_URL || "http://127.0.0.1:3000",

    // Collect trace when retrying the failed test
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",

    // Video on failure
    video: "on-first-retry",

    // Viewport size
    viewport: { width: 1440, height: 900 },

    // Navigation timeout
    navigationTimeout: 30_000,

    // Action timeout
    actionTimeout: 10_000,

    // Ignore HTTPS errors
    ignoreHTTPSErrors: true,

    // Locale
    locale: "en-US",

    // Timezone
    timezoneId: "America/New_York",
  },

  // Configure projects for major browsers
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },

    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 375, height: 812 },
      },
    },

    {
      name: "tablet",
      use: {
        ...devices["iPad (gen 7)"],
        viewport: { width: 810, height: 1080 },
      },
    },
  ],

  // Web server (start automatically before tests)
  webServer: {
    command: "cd .. && node app.js",
    port: 3000,
    timeout: 30_000,
    reuseExistingServer: true,
    env: {
      NODE_ENV: "test",
    },
  },
});
