// --------------------------
// HELPERS: Test Utilities
// --------------------------

/**
 * Generate a unique test name with timestamp
 * @param {string} prefix - Prefix for the name
 * @returns {string} Unique name like "test-kb-1693401234567"
 */
export function uniqueName(prefix = "test") {
  return `${prefix}-${Date.now()}`;
}

/**
 * Wait for network to be idle
 * @param {import("@playwright/test").Page} page
 */
export async function waitForIdle(page) {
  await page.waitForLoadState("networkidle");
}

/**
 * Take a named screenshot
 * @param {import("@playwright/test").Page} page
 * @param {string} name
 */
export async function takeScreenshot(page, name) {
  await page.screenshot({
    path: `test-results/screenshots/${name}.png`,
    fullPage: true,
  });
}

/**
 * Check for console errors
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<string[]>} Array of error messages
 */
export async function getConsoleErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(msg.text());
    }
  });
  return errors;
}

/**
 * Wait for toast/notification
 * @param {import("@playwright/test").Page} page
 * @param {string} text
 */
export async function waitForToast(page, text) {
  await page.getByText(text).waitFor({ timeout: 10000 });
}

/**
 * Clear localStorage (reset app state)
 * @param {import("@playwright/test").Page} page
 */
export async function clearAppState(page) {
  await page.evaluate(() => {
    localStorage.clear();
  });
}

/**
 * Check if element is visible
 * @param {import("@playwright/test").Locator} locator
 * @returns {Promise<boolean>}
 */
export async function isVisible(locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}
