import { test, expect, type Page } from "@playwright/test";
import { loginWithMouse } from "./helpers";

/**
 * Dummy happy-path journeys — thin end-to-end click-throughs of the core write/interaction surfaces
 * against the demo backend. Not exhaustive behaviour (that's the unit/component suites); these prove
 * the wiring holds from the user's seat: the control is reachable, opens, accepts input, and the
 * flow completes without a crash or a stuck spinner.
 */

/** Pick the first option of an open Radix Select / listbox. */
async function chooseFirstOption(page: Page): Promise<string> {
  const option = page.getByRole("option").first();
  await expect(option).toBeVisible();
  const label = (await option.textContent())?.trim() ?? "";
  await option.click();
  return label;
}

test("create-task journey: pick a project, open New Task, fill it, submit", async ({ page }) => {
  await loginWithMouse(page);
  await page.goto("/");

  // Set the active project (governs the global New Issue action) via the header Select.
  await page.getByRole("combobox", { name: /active project/i }).click();
  await chooseFirstOption(page);

  // The New Issue button is now enabled — open the New Task dialog.
  const newIssue = page.getByTestId("new-issue-button");
  await expect(newIssue).toBeEnabled();
  await newIssue.click();

  const dialog = page.getByRole("dialog", { name: /new task/i });
  await expect(dialog).toBeVisible();

  // Ensure a project is chosen inside the dialog (defaults to the active one; select if not).
  const createBtn = dialog.getByRole("button", { name: /create task/i });
  await dialog.getByPlaceholder(/wire the auth callback/i).fill("E2E smoke task");
  if (!(await createBtn.isEnabled())) {
    await dialog.getByRole("combobox", { name: /project/i }).click();
    await chooseFirstOption(page);
  }
  await expect(createBtn).toBeEnabled();
  await createBtn.click();

  // The flow completes: the dialog closes (create resolved) without an error surface.
  await expect(dialog).toBeHidden();
});

test("reports journey: choose a project in the report picker and see it applied", async ({ page }) => {
  await loginWithMouse(page);
  await page.goto("/reports");

  const picker = page.getByTestId("reports-project-select");
  await expect(picker).toBeVisible();
  await picker.click();
  const chosen = await chooseFirstOption(page);

  // The trigger reflects the chosen project — the selection round-tripped through the page.
  if (chosen) await expect(picker).toContainText(chosen.slice(0, 12), { ignoreCase: true });
});

test("settings journey: edit a field and commit changes without error", async ({ page }) => {
  await loginWithMouse(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: /system configuration/i })).toBeVisible();

  // Edit a validated field to a good value, then commit.
  const oidc = page.locator("#oidc-url");
  await oidc.scrollIntoViewIfNeeded();
  await oidc.fill("https://auth.example.com/realms/omni");

  const commit = page.getByRole("button", { name: /commit changes/i });
  await expect(commit).toBeEnabled();
  await commit.click();

  // The mutation resolves: the button is not stuck on SAVING… and no validation alert is shown.
  await expect(page.getByRole("button", { name: /commit changes/i })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
