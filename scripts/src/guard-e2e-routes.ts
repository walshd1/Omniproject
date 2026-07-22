/**
 * Route-coverage guard — every client route declared in the SPA's `App.tsx` (`path="…"`) must have
 * a matching entry in the e2e route manifest (`artifacts/omniproject/e2e/routes.ts`), and vice
 * versa. This binds the route-coverage smoke spec to the router the same way the other drift guards
 * bind generated artifacts to their source: a new page (or a deleted one) fails CI until the
 * end-to-end manifest is updated, so no route silently escapes the acceptance net.
 *
 * Run: pnpm --filter @workspace/scripts run guard-e2e-routes
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT as ROOT } from "./lib/repo-root";
import { reportGuard } from "./lib/guard-harness";

const APP_TSX = path.join(ROOT, "artifacts/omniproject/src/App.tsx");
const MANIFEST = path.join(ROOT, "artifacts/omniproject/e2e/routes.ts");

/** Pull every distinct `path="…"` literal out of a file. */
function routesFrom(file: string, attr: "path" | "pattern"): Set<string> {
  const src = fs.readFileSync(file, "utf8");
  const out = new Set<string>();
  if (attr === "pattern") {
    for (const m of src.matchAll(/pattern:\s*"([^"]+)"/g)) out.add(m[1]!);
    return out;
  }
  // Match `path="…"` ANYWHERE in the <Route …> open tag, not only as the first attribute — otherwise
  // `<Route element={<X/>} path="/new">` (path not first) escapes the required-route net entirely.
  for (const m of src.matchAll(/<Route\b/g)) {
    const window = src.slice(m.index!, m.index! + 400);
    const pm = window.match(/\bpath="([^"]+)"/);
    if (pm) out.add(pm[1]!);
  }
  return out;
}

const appRoutes = routesFrom(APP_TSX, "path");
const manifestRoutes = routesFrom(MANIFEST, "pattern");

const missing = [...appRoutes].filter((r) => !manifestRoutes.has(r)); // in App.tsx, not covered
const stale = [...manifestRoutes].filter((r) => !appRoutes.has(r)); // in manifest, not a real route

const routeViolations = [
  ...missing.map((r) => `missing an e2e/routes.ts entry for: ${r}`),
  ...stale.map((r) => `stale manifest entry (no such route): ${r}`),
];
reportGuard("route-coverage", {
  violations: routeViolations,
  failHeadline: "route-coverage guard: the e2e route manifest is out of sync with App.tsx.",
  help: "  Update artifacts/omniproject/e2e/routes.ts so every App.tsx route is covered.",
  okSummary: `all ${appRoutes.size} App.tsx routes are covered by the e2e manifest.`,
});
