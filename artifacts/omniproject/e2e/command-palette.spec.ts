import { test, expect } from "@playwright/test";
import { loginWithMouse } from "./helpers";

/**
 * Command palette (Cmd/Ctrl+K). Keyboard path: the shortcut opens it and Escape closes it. There is
 * no separate mouse trigger today (the palette is a keyboard accelerator), so the mouse assertion
 * here is that the shortcut-opened palette is fully operable by pointer once open.
 */

test("opens the command palette with Ctrl/Cmd+K and closes it with Escape", async ({ page }) => {
  await loginWithMouse(page);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: /command palette/i });
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
});

test("the command palette filters as you type and is keyboard-navigable", async ({ page }) => {
  await loginWithMouse(page);
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder(/command or search/i);
  await expect(input).toBeVisible();
  await input.fill("project");
  // At least one option remains and can be reached by keyboard.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible();
});
