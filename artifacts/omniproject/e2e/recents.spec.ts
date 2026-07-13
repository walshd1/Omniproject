import { test, expect } from "@playwright/test";
import { loginWithMouse } from "./helpers";

/**
 * Findability: recently-visited items. After a user opens a work item, the global-search overlay's
 * idle state offers it back under "Recent" — a one-keystroke way to return. Like every affordance it
 * must work both by mouse and by keyboard, so we prove both the visit (via a project page) and the
 * jump-back (Enter on the recent) against the demo backend.
 */

test("a visited project appears under Recent and is reachable by keyboard", async ({ page }) => {
  await loginWithMouse(page);
  await page.goto("/projects/proj-001");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Navigate away, then open search with no query — the visit is offered under "Recent".
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.keyboard.press("/");
  await expect(page.getByTestId("global-search-recent-heading")).toBeVisible();
  const results = page.getByTestId("global-search-results");
  await expect(results.getByRole("option").first()).toBeVisible();

  // Jump back to it with the keyboard.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\//);
});

test("a recent item is reachable by mouse click", async ({ page }) => {
  await loginWithMouse(page);
  await page.goto("/projects/proj-001");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.goto("/");
  await page.getByRole("button", { name: /^search$/i }).click();
  await expect(page.getByTestId("global-search-recent-heading")).toBeVisible();
  await page.getByTestId("global-search-results").getByRole("option").first().click();
  await expect(page).toHaveURL(/\/projects\//);
});
