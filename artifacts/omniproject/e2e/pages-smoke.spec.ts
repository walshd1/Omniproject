import { test, expect, type Page } from "@playwright/test";
import { loginWithMouse } from "./helpers";

/**
 * Deeper per-page smoke. The route-coverage net (routes.spec.ts) proves each route paints *an* <h1>;
 * this proves each page painted *its own* primary content — the page-specific heading AND a real
 * content region (a testid'd panel, a tab, a table) — so a page that renders a generic shell, the
 * wrong route, or an empty error surface fails here even though routes.spec would pass. Shallow but
 * page-aware: one signed-in session reused across pages (per-route login trips the rate limiter).
 */

interface PageCase {
  path: string;
  /** A heading that must be visible on this page (case-insensitive). */
  heading: RegExp;
  /** At least one of these testids/locators must be visible (the page's real content region). */
  anyOf?: () => (page: Page) => ReturnType<Page["locator"]>[];
}

const CASES: { path: string; heading: RegExp; testids?: string[]; tab?: RegExp }[] = [
  { path: "/", heading: /dashboard/i },
  { path: "/my-work", heading: /my work/i, testids: ["my-work-list", "my-work-empty"] },
  { path: "/dashboards", heading: /dashboards/i, testids: ["dashboard-grid", "dashboards-empty", "dashboard-live"] },
  { path: "/content", heading: /content/i, testids: ["content-page-grid", "content-pages-empty"] },
  { path: "/wiki", heading: /wiki/i, testids: ["wiki-page"] },
  { path: "/programmes", heading: /programmes/i },
  { path: "/projects", heading: /projects index/i },
  { path: "/projects/proj-001", heading: /.+/, tab: /grid|board|timeline/i },
  { path: "/reports", heading: /enterprise reporting/i },
  { path: "/resources", heading: /resource planning/i, testids: ["capacity-summary"] },
  { path: "/explore", heading: /exploration sandbox/i, testids: ["explore-mode"] },
  // A normal (non-guest) demo session hits the portal's "unavailable" notice — the page still paints its
  // own heading + testid, which is what the smoke checks (guest-only content needs a guest session).
  { path: "/portal", heading: /project portal/i, testids: ["portal-page"] },
  { path: "/settings", heading: /system configuration/i },
  { path: "/configurator", heading: /configurator/i },
  { path: "/setup", heading: /.+/, testids: ["setup-start-here"] },
];

test.describe.serial("per-page smoke", () => {
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginWithMouse(page);
  });
  test.afterAll(async () => { await page.close(); });

  for (const c of CASES) {
    test(`page renders its own content: ${c.path}`, async () => {
      const resp = await page.goto(c.path);
      expect(resp?.status() ?? 0, `document status for ${c.path}`).toBeLessThan(400);

      // Page-specific heading (never the "Page not found" boundary).
      await expect(page.getByRole("heading", { name: c.heading }).first(), `heading on ${c.path}`).toBeVisible();
      await expect(page.getByRole("heading", { name: /page not found/i }), `no 404 on ${c.path}`).toHaveCount(0);

      // A real content region for the page (any-of testids), where the page declares one.
      if (c.testids?.length) {
        const anyVisible = c.testids.map((id) => page.getByTestId(id));
        // At least one of the declared content regions is present in the DOM.
        let seen = 0;
        for (const loc of anyVisible) seen += await loc.count();
        expect(seen, `a content region (${c.testids.join(" | ")}) on ${c.path}`).toBeGreaterThan(0);
      }
      if (c.tab) {
        await expect(page.getByRole("tab", { name: c.tab }).first(), `a tab on ${c.path}`).toBeVisible();
      }
    });
  }
});
