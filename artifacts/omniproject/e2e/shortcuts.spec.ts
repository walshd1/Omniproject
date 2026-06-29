import { test, expect } from "@playwright/test";
import { loginWithMouse } from "./helpers";

/**
 * Keyboard-shortcuts help. Discoverable both ways: the "?" key opens the cheatsheet (keyboard) and
 * the header "?" button opens it (mouse). It documents the real bindings, incl. the G-chord nav.
 */

test("opens the shortcuts help with the '?' key and closes with Escape", async ({ page }) => {
  await loginWithMouse(page);
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: /keyboard shortcuts/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/open command palette/i)).toBeVisible();
  await expect(dialog.getByText(/go to dashboard/i)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("opens the shortcuts help from the header button (mouse)", async ({ page }) => {
  await loginWithMouse(page);
  await page.getByRole("button", { name: /keyboard shortcuts/i }).click();
  await expect(page.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeVisible();
});

test("the G+P chord navigates to Projects (keyboard)", async ({ page }) => {
  await loginWithMouse(page);
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page).toHaveURL(/\/projects/);
});

test("the G+E chord navigates to Explore (keyboard) — newly wired", async ({ page }) => {
  await loginWithMouse(page);
  await page.keyboard.press("g");
  await page.keyboard.press("e");
  await expect(page).toHaveURL(/\/explore/);
});
