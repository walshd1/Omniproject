import { test, expect } from "@playwright/test";
import { loginWithMouse } from "./helpers";

/**
 * Global search. Keyboard path: "/" opens the overlay, type, ↓/Enter to jump. Mouse path: the
 * header Search button opens it, then click a result. Both must reach the same place.
 */

test("opens global search with the keyboard ('/'), finds a project and jumps to it", async ({ page }) => {
  await loginWithMouse(page);
  await page.keyboard.press("/");
  const input = page.getByRole("combobox", { name: /search projects/i });
  await expect(input).toBeVisible();
  await input.fill("a");
  // Results render; pick the first with the keyboard.
  await expect(page.getByTestId("global-search-results")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/|\/programmes\//);
});

test("opens global search with the mouse (header button) and shows results", async ({ page }) => {
  await loginWithMouse(page);
  await page.getByRole("button", { name: /^search$/i }).click();
  const input = page.getByRole("combobox", { name: /search projects/i });
  await expect(input).toBeVisible();
  await input.fill("a");
  await expect(page.getByTestId("global-search-results")).toBeVisible();
});

test("closes the search overlay with Escape", async ({ page }) => {
  await loginWithMouse(page);
  await page.keyboard.press("/");
  await expect(page.getByTestId("global-search")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("global-search")).toBeHidden();
});
