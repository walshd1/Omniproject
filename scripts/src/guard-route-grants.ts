/**
 * ROUTE-GRANT guard (IAM assessment gap S6) — every MUTATING route (POST/PUT/PATCH/DELETE) on the api-server
 * must have its authorization posture DECLARED and checkable, so none silently escapes the auth net. A route
 * satisfies the guard one of two ways:
 *   1. it carries a recognised per-route auth middleware (requireRole / requireAuth / requireAnyRole /
 *      requireRealAdmin / requireStepUp / breakGlassAuth / … — the declarative, common case), OR
 *   2. it is listed in the route-auth manifest (artifacts/api-server/src/routes/route-auth-manifest.ts) with
 *      an explicit posture + reason (a pre-auth entry point, a signature-verified webhook, a mount-level
 *      token gate, an in-handler session/role check, or a stateless verify).
 *
 * FAIL-CLOSED, both directions (the same discipline as guard-superset):
 *   - a mutating route with NEITHER a middleware gate NOR a manifest entry fails CI — a newly-added route is
 *     unclassified until a human declares how it is authorised;
 *   - a manifest entry that no longer matches an unguarded route (the route grew a middleware gate, changed
 *     path, or was deleted) fails too, so the manifest can never rot into a stale rubber-stamp.
 *
 * Read-only + deterministic: it parses the route table as text and reports in the house style.
 *
 * Run: pnpm --filter @workspace/scripts run guard-route-grants
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT as ROOT } from "./lib/repo-root";
import { reportGuard } from "./lib/guard-harness";
import { ROUTE_AUTH_EXCEPTIONS } from "../../artifacts/api-server/src/routes/route-auth-manifest";

const ROUTES_DIR = path.join(ROOT, "artifacts/api-server/src/routes");

/** Per-route middleware that establishes / re-verifies an authenticated principal. A route carrying any of
 *  these (as a bare reference or a `gate(...)` call) is considered to declare its requirement inline. */
const AUTH_GATES = [
  "requireRole",
  "requireAnyRole",
  "requireAdminOrPmo",
  "requireRealAdmin",
  "requireAuth",
  "requireSub",
  "requirePortal",
  "requireStepUp",
  "breakGlassAuth",
  "ingestAuth",
];

const METHODS = ["post", "put", "patch", "delete"] as const;
type Method = (typeof METHODS)[number];

interface DiscoveredRoute {
  file: string;
  method: Method;
  path: string;
  hasGate: boolean;
}

const keyOf = (r: { file: string; method: string; path: string }): string => `${r.file}::${r.method}::${r.path}`;

/** Extract the balanced `(...)` call text starting at `openIdx` (a "("), honouring string literals. Caps at
 *  a generous window so a huge handler body never runs away — the middleware + first `=>` are near the front. */
function extractCall(src: string, openIdx: number): string {
  let depth = 0;
  let inStr: string | null = null;
  let prev = "";
  const cap = Math.min(src.length, openIdx + 1200);
  for (let i = openIdx; i < cap; i++) {
    const c = src[i]!;
    if (inStr) {
      if (c === inStr && prev !== "\\") inStr = null;
      prev = c;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      prev = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
    prev = c;
  }
  return src.slice(openIdx, cap);
}

/** Scan every route file for mutating router calls and whether each declares a per-route auth gate. */
export function discoverMutatingRoutes(): DiscoveredRoute[] {
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const out: DiscoveredRoute[] = [];
  for (const file of files.sort()) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");
    const re = /\b\w*[Rr]outer\.(post|put|patch|delete)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const method = m[1] as Method;
      const openIdx = m.index + m[0].length - 1;
      const call = extractCall(src, openIdx);
      const pathMatch = call.match(/^\(\s*(["'`])([^"'`]*)\1/);
      const routePath = pathMatch ? pathMatch[2]! : "(dynamic)";
      // Middleware always precedes the handler; the handler is the first `=>` (or a bare identifier when
      // there is none). Searching for a gate token BEFORE the first `=>` avoids false hits in handler bodies.
      const arrow = call.indexOf("=>");
      const region = arrow >= 0 ? call.slice(0, arrow) : call;
      const hasGate = AUTH_GATES.some((g) => new RegExp(`\\b${g}\\b`).test(region));
      out.push({ file, method, path: routePath, hasGate });
    }
  }
  return out;
}

/** The bidirectional invariant, as a pure function over discovered routes + the manifest (so it is testable
 *  without touching the process): unclassified unguarded routes AND stale manifest entries are both failures. */
export function computeRouteGrantViolations(
  discovered: readonly DiscoveredRoute[],
  manifest: readonly { file: string; method: string; path: string }[],
): string[] {
  const unguarded = discovered.filter((r) => !r.hasGate);
  const unguardedKeys = new Set(unguarded.map(keyOf));
  const manifestKeys = new Set(manifest.map(keyOf));

  // Direction 1: an unguarded mutating route with no manifest entry is unclassified.
  const unclassified = unguarded
    .filter((r) => !manifestKeys.has(keyOf(r)))
    .map((r) => `unclassified mutating route ${r.file} ${r.method.toUpperCase()} ${r.path} — add a per-route auth middleware (requireRole/requireAuth/…) or a reasoned route-auth-manifest.ts entry`);

  // Direction 2: a manifest entry that no longer matches an unguarded route (grew a gate / moved / deleted).
  const stale = manifest
    .filter((e) => !unguardedKeys.has(keyOf(e)))
    .map((e) => `stale route-auth-manifest entry ${e.file} ${e.method.toUpperCase()} ${e.path} — it now carries a middleware gate, changed, or no longer exists; remove it`);

  return [...unclassified, ...stale];
}

// CLI entry: scan the real tree, report in the house style, and exit non-zero on any violation.
if (import.meta.url === `file://${process.argv[1]}`) {
  const discovered = discoverMutatingRoutes();
  const guardedCount = discovered.filter((r) => r.hasGate).length;
  reportGuard("route-grants", {
    violations: computeRouteGrantViolations(discovered, ROUTE_AUTH_EXCEPTIONS),
    failHeadline: "route-grants guard: a mutating route's authorization posture is undeclared or the manifest is stale.",
    help: "  Every POST/PUT/PATCH/DELETE route must carry a recognised auth middleware OR a reasoned entry in\n  artifacts/api-server/src/routes/route-auth-manifest.ts. Keep that manifest in sync with the route table.",
    okSummary: `all ${discovered.length} mutating routes declare an auth posture (${guardedCount} via middleware, ${discovered.length - guardedCount} via a reasoned manifest entry).`,
  });
}
