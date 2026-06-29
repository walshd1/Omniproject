import { test, expect, type Page } from "@playwright/test";
import { loginWithMouse } from "./helpers";
import { ROUTES } from "./routes";

/**
 * Route-coverage smoke — visits EVERY client route (manifest kept in sync with App.tsx by the
 * guard-e2e-routes CI check) and proves each one renders in the real browser against the demo
 * backend: the document responds < 400, the page paints its <h1> (not the error boundary or a
 * blank chunk-load), and nothing throws an uncaught exception or returns an unexpected 5xx. The
 * cheap, broad net that catches whole-app regressions — like the relative-STATIC_DIR /login 500.
 *
 * We sign in ONCE and reuse the session across routes (signing in per route would trip the login
 * rate-limiter and is slower). The unauthenticated /login screen is checked on its own fresh page.
 */

test.describe.serial("route coverage", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginWithMouse(page);
  });
  test.afterAll(async () => { await page.close(); });

  for (const route of ROUTES.filter((r) => !r.isLogin)) {
    test(`route renders without errors: ${route.path}`, async () => {
      const pageErrors: string[] = [];
      const serverErrors: string[] = [];
      page.removeAllListeners("pageerror");
      page.removeAllListeners("response");
      page.on("pageerror", (e) => pageErrors.push(e.message));
      page.on("response", (r) => {
        // Ignore health-check polling (returns 5xx in demo with no broker) — not a page regression.
        if (r.status() >= 500 && !/\/healthz?\b/.test(r.url())) {
          serverErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
        }
      });

      const resp = await page.goto(route.path);
      expect(resp?.status() ?? 0, `document status for ${route.path}`).toBeLessThan(400);
      await expect(page.locator("h1").first(), `<h1> on ${route.path}`).toBeVisible();
      expect(pageErrors, `uncaught exceptions on ${route.path}`).toEqual([]);
      expect(serverErrors, `unexpected 5xx on ${route.path}`).toEqual([]);
    });
  }
});

test("route renders without errors: /login (unauthenticated)", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const resp = await page.goto("/login");
  expect(resp?.status() ?? 0).toBeLessThan(400);
  await expect(page.getByRole("button", { name: /enter \(demo mode\)|sign in/i })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
