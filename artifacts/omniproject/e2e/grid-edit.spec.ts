import { test, expect } from "@playwright/test";
import { loginWithMouse } from "./helpers";

/**
 * Editable grid — the inline-edit affordance must open both by mouse and by keyboard. (The write +
 * optimistic-update + Undo behaviour itself is covered deterministically by the hook/component
 * tests in src/lib/use-issue-field-write.test.tsx and the grid/side-panel component tests; here we
 * prove the surface is reachable and the editor is operable both ways against the demo backend.)
 */

async function openGrid(page: import("@playwright/test").Page) {
  await loginWithMouse(page);
  await page.goto("/projects/proj-001");
  const gridTab = page.getByRole("tab", { name: /grid/i });
  await expect(gridTab).toBeVisible();
  await gridTab.click();
  await expect(page.getByTestId("grid-table")).toBeVisible();
}

test("opens a cell editor with the mouse", async ({ page }) => {
  await openGrid(page);
  await page.getByRole("button", { name: /^Edit Status for / }).first().click();
  await expect(page.getByRole("combobox").first()).toBeVisible();
});

test("opens a cell editor with the keyboard (focus + Enter)", async ({ page }) => {
  await openGrid(page);
  const editBtn = page.getByRole("button", { name: /^Edit Status for / }).first();
  await editBtn.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox").first()).toBeVisible();
});

test("toggles a sortable column header (mouse + keyboard)", async ({ page }) => {
  await openGrid(page);
  // The sort control is a <button> inside the columnheader; per ARIA, aria-sort lives on the
  // columnheader cell (the <th>), not the button. Drive the button, assert on the header.
  const sortButton = page.getByRole("button", { name: /^Title/ }).first();
  const columnHeader = page.getByRole("columnheader", { name: /Title/ }).first();
  await sortButton.click();
  await expect(columnHeader).toHaveAttribute("aria-sort", /ascending|descending/);
  await sortButton.focus();
  await page.keyboard.press("Enter");
  await expect(columnHeader).toHaveAttribute("aria-sort", /ascending|descending/);
});
