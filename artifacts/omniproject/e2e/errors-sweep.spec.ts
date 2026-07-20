import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { loginWithMouse } from "./helpers";
import { ROUTES } from "./routes";

/**
 * Console + network error sweep. routes.spec.ts asserts no *uncaught exception* and no unexpected
 * 5xx per route; this widens the net to any `console.error` emitted while the page loads AND while a
 * common global interaction runs (open + close the command palette), catching the class of silent
 * failures that don't throw — a rejected fetch logged to the console, a React render error swallowed
 * by an error boundary, a failed lazy import — anywhere in the app. One signed-in session, reused.
 */

// Benign console noise that is expected in demo mode (no broker/backend wired) and is NOT a
// regression: the health poll 5xx, favicon, and generic resource-load lines for those.
// `/api/portal/status` is a 404-by-design for a non-guest session: the portal page fetches it and
// shows an "unavailable" notice when the caller isn't a scoped guest (the sweep drives it as an admin).
// Like the healthz probe, that 404 is expected in this demo context, not a regression.
const BENIGN = [/healthz?/i, /favicon/i, /manifest\.webmanifest/i, /\/api\/portal\/status/i];
const isBenign = (text: string) => BENIGN.some((re) => re.test(text));

function collect(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  const onConsole = (m: ConsoleMessage) => {
    if (m.type() === "error" && !isBenign(m.text())) consoleErrors.push(m.text());
  };
  const onPageError = (e: Error) => pageErrors.push(e.message);
  const onResponse = (r: import("@playwright/test").Response) => {
    if (r.status() >= 500 && !isBenign(r.url())) serverErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);
  return { consoleErrors, pageErrors, serverErrors };
}

test.describe.serial("error sweep", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginWithMouse(page);
  });
  test.afterAll(async () => { await page.close(); });

  for (const route of ROUTES.filter((r) => !r.isLogin)) {
    test(`clean console + network: ${route.path}`, async () => {
      page.removeAllListeners("console");
      page.removeAllListeners("pageerror");
      page.removeAllListeners("response");
      const sink = collect(page);

      await page.goto(route.path);
      await expect(page.getByRole("heading").first()).toBeVisible();

      // Exercise interactive JS that lives on every page: the command palette accelerator.
      await page.keyboard.press("Control+k");
      const palette = page.getByRole("dialog", { name: /command palette/i });
      if (await palette.isVisible().catch(() => false)) {
        await page.keyboard.press("Escape");
        await expect(palette).toBeHidden();
      }

      expect(sink.pageErrors, `uncaught exceptions on ${route.path}`).toEqual([]);
      expect(sink.consoleErrors, `console errors on ${route.path}`).toEqual([]);
      expect(sink.serverErrors, `unexpected 5xx on ${route.path}`).toEqual([]);
    });
  }
});
