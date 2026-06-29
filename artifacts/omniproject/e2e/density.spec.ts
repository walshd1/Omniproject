import { test, expect } from "@playwright/test";
import { loginWithMouse } from "./helpers";

/**
 * UI density (comfortable/compact) is a per-user design-token preference applied app-wide via the
 * <html data-density> attribute (lib/a11y-prefs → index.css --spacing). The control lives in the
 * Accessibility card on /settings and, like every affordance, must be operable both by mouse and by
 * keyboard. Here we drive the real control against the demo backend and assert the document root
 * picks up the chosen density; the persistence/clamping itself is covered by the unit tests.
 */

async function openAccessibility(page: import("@playwright/test").Page) {
  await loginWithMouse(page);
  await page.goto("/settings");
  const compact = page.getByRole("button", { name: "Compact" });
  await expect(compact).toBeVisible();
  return compact;
}

test("switches to compact density with the mouse", async ({ page }) => {
  const compact = await openAccessibility(page);
  await compact.click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(compact).toHaveAttribute("aria-pressed", "true");
});

test("switches density with the keyboard (focus + Enter)", async ({ page }) => {
  const compact = await openAccessibility(page);
  await compact.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  const comfortable = page.getByRole("button", { name: "Comfortable" });
  await comfortable.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
});
