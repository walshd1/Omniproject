import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverMutatingRoutes, computeRouteGrantViolations } from "./guard-route-grants";
import { ROUTE_AUTH_EXCEPTIONS } from "../../artifacts/api-server/src/routes/route-auth-manifest";

/**
 * Unit coverage for the route-grants guard (IAM gap S6). The registry test (guard-scripts.test.ts) already
 * spawns the guard and asserts exit 0 on the committed tree; here we exercise the pure classification so the
 * FAIL-CLOSED behaviour (and the manifest's coherence with the real route table) is pinned directly.
 */

test("the committed route table satisfies the invariant (no violations)", () => {
  const discovered = discoverMutatingRoutes();
  assert.ok(discovered.length > 100, `expected many mutating routes, found ${discovered.length}`);
  assert.deepEqual(computeRouteGrantViolations(discovered, ROUTE_AUTH_EXCEPTIONS), []);
});

test("every manifest entry maps to a real, currently-unguarded route (no dead entries)", () => {
  const unguarded = new Set(discoverMutatingRoutes().filter((r) => !r.hasGate).map((r) => `${r.file}::${r.method}::${r.path}`));
  for (const e of ROUTE_AUTH_EXCEPTIONS) {
    assert.ok(unguarded.has(`${e.file}::${e.method}::${e.path}`), `manifest entry has no matching unguarded route: ${e.file} ${e.method} ${e.path}`);
  }
});

test("fail-closed: an unguarded route absent from the manifest is a violation", () => {
  const discovered = [{ file: "new.ts", method: "post" as const, path: "/new/thing", hasGate: false }];
  const violations = computeRouteGrantViolations(discovered, []);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /unclassified mutating route new\.ts POST \/new\/thing/);
});

test("a gated route needs no manifest entry", () => {
  const discovered = [{ file: "x.ts", method: "put" as const, path: "/x", hasGate: true }];
  assert.deepEqual(computeRouteGrantViolations(discovered, []), []);
});

test("stale-manifest detection: a manifest entry with no matching unguarded route is flagged", () => {
  // The route now carries a gate (hasGate: true) → the manifest entry for it is stale.
  const discovered = [{ file: "x.ts", method: "post" as const, path: "/x", hasGate: true }];
  const manifest = [{ file: "x.ts", method: "post", path: "/x" }];
  const violations = computeRouteGrantViolations(discovered, manifest);
  assert.equal(violations.length, 1);
  assert.match(violations[0]!, /stale route-auth-manifest entry x\.ts POST \/x/);
});

test("an unguarded route WITH a manifest entry passes (classified exception)", () => {
  const discovered = [{ file: "auth.ts", method: "post" as const, path: "/auth/local", hasGate: false }];
  const manifest = [{ file: "auth.ts", method: "post", path: "/auth/local" }];
  assert.deepEqual(computeRouteGrantViolations(discovered, manifest), []);
});
