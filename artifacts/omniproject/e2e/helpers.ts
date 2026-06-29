import { type Page, expect } from "@playwright/test";

/**
 * Shared acceptance helpers. Demo mode issues a local session when the user activates the single
 * "ENTER (DEMO MODE)" control on the login screen — so both a mouse and a keyboard helper exist,
 * mirroring the product rule that every affordance works both ways.
 */

const DEMO_BUTTON = /enter \(demo mode\)|sign in/i;

/** Log in via the demo button using the MOUSE (click). Lands on the dashboard. */
export async function loginWithMouse(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByRole("button", { name: DEMO_BUTTON }).click();
  await expect(page).toHaveURL(/\/$|\/#?$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** Log in via the demo button using the KEYBOARD only (focus + Enter). */
export async function loginWithKeyboard(page: Page): Promise<void> {
  await page.goto("/login");
  const button = page.getByRole("button", { name: DEMO_BUTTON });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
