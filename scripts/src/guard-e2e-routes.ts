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
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const APP_TSX = path.join(ROOT, "artifacts/omniproject/src/App.tsx");
const MANIFEST = path.join(ROOT, "artifacts/omniproject/e2e/routes.ts");

/** Pull every distinct `path="…"` literal out of a file. */
function routesFrom(file: string, attr: "path" | "pattern"): Set<string> {
  const src = fs.readFileSync(file, "utf8");
  const re = attr === "path" ? /<Route\s+path="([^"]+)"/g : /pattern:\s*"([^"]+)"/g;
  const out = new Set<string>();
  for (const m of src.matchAll(re)) out.add(m[1]!);
  return out;
}

const appRoutes = routesFrom(APP_TSX, "path");
const manifestRoutes = routesFrom(MANIFEST, "pattern");

const missing = [...appRoutes].filter((r) => !manifestRoutes.has(r)); // in App.tsx, not covered
const stale = [...manifestRoutes].filter((r) => !appRoutes.has(r)); // in manifest, not a real route

if (missing.length || stale.length) {
  console.error("route-coverage guard: the e2e route manifest is out of sync with App.tsx.");
  if (missing.length) console.error(`  Missing an e2e/routes.ts entry for: ${missing.join(", ")}`);
  if (stale.length) console.error(`  Stale manifest entries (no such route): ${stale.join(", ")}`);
  console.error("  Update artifacts/omniproject/e2e/routes.ts so every App.tsx route is covered.");
  process.exit(1);
}

console.log(`route-coverage guard: OK — all ${appRoutes.size} App.tsx routes are covered by the e2e manifest.`);
