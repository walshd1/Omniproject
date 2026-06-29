import { test, expect } from "@playwright/test";
import { loginWithMouse, loginWithKeyboard } from "./helpers";

/**
 * App shell + sign-in. Demo mode issues a local session from the login screen. Proven both ways:
 * a mouse click on the demo button, and focus + Enter with no pointer.
 */

test("signs in via the demo button with the mouse and lands on the dashboard", async ({ page }) => {
  await loginWithMouse(page);
  await expect(page.getByRole("heading", { level: 1, name: /dashboard/i })).toBeVisible();
});

test("signs in via the keyboard only (focus + Enter)", async ({ page }) => {
  await loginWithKeyboard(page);
  await expect(page.getByRole("heading", { level: 1, name: /dashboard/i })).toBeVisible();
});

test("navigates to Projects from the sidebar with the mouse", async ({ page }) => {
  await loginWithMouse(page);
  await page.getByRole("link", { name: /projects/i }).first().click();
  await expect(page).toHaveURL(/\/projects/);
});

test("navigates to Projects from the sidebar with the keyboard", async ({ page }) => {
  await loginWithMouse(page); // sign-in itself is covered above; focus the journey under test
  const projects = page.getByRole("link", { name: /projects/i }).first();
  await projects.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects/);
});
