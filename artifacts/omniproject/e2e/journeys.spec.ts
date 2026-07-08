import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginWithMouse, loginWithKeyboard } from "./helpers";

/**
 * Dummy happy-path journeys — thin end-to-end click-throughs of the core write/interaction surfaces
 * against the demo backend. Not exhaustive behaviour (that's the unit/component suites); these prove
 * the wiring holds from the user's seat: the control is reachable, opens, accepts input, and the
 * flow completes without a crash or a stuck spinner.
 *
 * Every journey is written twice — a MOUSE path and a KEYBOARD-only path — because the product rule
 * is that every affordance is operable both by pointer and by keyboard (mirrors app/search/grid specs).
 */

/** Open a Radix Select with the mouse and click its first option; returns the chosen label. */
async function chooseFirstOptionByMouse(page: Page, trigger: Locator): Promise<string> {
  await trigger.click();
  const option = page.getByRole("option").first();
  await expect(option).toBeVisible();
  const label = (await option.textContent())?.trim() ?? "";
  await option.click();
  return label;
}

/** Open a Radix Select with the keyboard only (focus → Enter) and pick an option (↓ → Enter). */
async function chooseOptionByKeyboard(page: Page, trigger: Locator): Promise<void> {
  await trigger.focus();
  await page.keyboard.press("Enter"); // open the listbox
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("ArrowDown"); // highlight an option
  await page.keyboard.press("Enter"); // commit the highlighted option
  await expect(page.getByRole("listbox")).toBeHidden();
}

// ── create a task ────────────────────────────────────────────────────────────
async function openNewTaskDialog(page: Page): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name: /new task/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("create-task journey (mouse)", async ({ page }) => {
  await loginWithMouse(page);
  await page.goto("/");

  await chooseFirstOptionByMouse(page, page.getByRole("combobox", { name: /active project/i }));

  const newIssue = page.getByTestId("new-issue-button");
  await expect(newIssue).toBeEnabled();
  await newIssue.click();

  const dialog = await openNewTaskDialog(page);
  const createBtn = dialog.getByRole("button", { name: /create task/i });
  await dialog.getByPlaceholder(/wire the auth callback/i).fill("E2E smoke task (mouse)");
  if (!(await createBtn.isEnabled())) {
    await chooseFirstOptionByMouse(page, dialog.getByRole("combobox", { name: /project/i }));
  }
  await expect(createBtn).toBeEnabled();
  await createBtn.click();
  await expect(dialog).toBeHidden();
});

test("create-task journey (keyboard)", async ({ page }) => {
  await loginWithKeyboard(page);
  await page.goto("/");

  // Set the active project with the keyboard, then open New Issue with focus + Enter.
  await chooseOptionByKeyboard(page, page.getByRole("combobox", { name: /active project/i }));

  const newIssue = page.getByTestId("new-issue-button");
  await expect(newIssue).toBeEnabled();
  await newIssue.focus();
  await page.keyboard.press("Enter");

  const dialog = await openNewTaskDialog(page);
  const title = dialog.getByPlaceholder(/wire the auth callback/i);
  await title.focus();
  await page.keyboard.type("E2E smoke task (keyboard)");

  const createBtn = dialog.getByRole("button", { name: /create task/i });
  if (!(await createBtn.isEnabled())) {
    await chooseOptionByKeyboard(page, dialog.getByRole("combobox", { name: /project/i }));
  }
  await expect(createBtn).toBeEnabled();
  await createBtn.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
});

// ── choose a report project ──────────────────────────────────────────────────
test("reports journey (mouse)", async ({ page }) => {
  await loginWithMouse(page);
  await page.goto("/reports");

  const picker = page.getByTestId("reports-project-select");
  await expect(picker).toBeVisible();
  const chosen = await chooseFirstOptionByMouse(page, picker);
  if (chosen) await expect(picker).toContainText(chosen.slice(0, 12), { ignoreCase: true });
});

test("reports journey (keyboard)", async ({ page }) => {
  await loginWithKeyboard(page);
  await page.goto("/reports");

  const picker = page.getByTestId("reports-project-select");
  await expect(picker).toBeVisible();
  await chooseOptionByKeyboard(page, picker);
  // The keyboard open → navigate → commit cycle completed and left a concrete selection.
  await expect(picker).not.toBeEmpty();
});

// ── edit + commit settings ───────────────────────────────────────────────────
async function assertSettingsCommitted(page: Page): Promise<void> {
  // The mutation resolves: the button is not stuck on SAVING… and no validation alert is shown.
  await expect(page.getByRole("button", { name: /commit changes/i })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}

test("settings journey (mouse)", async ({ page }) => {
  await loginWithMouse(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: /system configuration/i })).toBeVisible();

  const oidc = page.locator("#oidc-url");
  await oidc.scrollIntoViewIfNeeded();
  await oidc.fill("https://auth.example.com/realms/omni");

  const commit = page.getByRole("button", { name: /commit changes/i });
  await expect(commit).toBeEnabled();
  await commit.click();
  await assertSettingsCommitted(page);
});

test("settings journey (keyboard)", async ({ page }) => {
  await loginWithKeyboard(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: /system configuration/i })).toBeVisible();

  const oidc = page.locator("#oidc-url");
  await oidc.scrollIntoViewIfNeeded();
  await oidc.focus();
  await page.keyboard.type("https://auth.example.com/realms/omni");

  const commit = page.getByRole("button", { name: /commit changes/i });
  await expect(commit).toBeEnabled();
  await commit.focus();
  await page.keyboard.press("Enter");
  await assertSettingsCommitted(page);
});
