import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, cookie, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * REAL RBAC enforcement over the live app — the coverage the rest of the route suite can't give.
 *
 * Every other harness-based route test boots in DEMO auth (no IdP configured), where `grantsFromClaims`
 * hands every session all authorities — so `adminCookie()` and `memberCookie()` are the SAME principal
 * and any "member gets 200" assertion is tautological. This file deliberately leaves demo mode
 * (`isDemoAuth` checks the auth env live, per request) and pins the claim→role env, so the five fixed
 * roles map deterministically and the gates are genuinely exercised end-to-end.
 *
 * It also pins down two load-bearing subtleties of the model that a demo-mode (all-authorities) test
 * can never catch:
 *  - `pmo` and `admin` are ORTHOGONAL authorities (lib/rbac.ts grantsSatisfy) — a pure admin does NOT
 *    satisfy a `pmo` gate and vice versa;
 *  - the pmo/admin authorities are only granted with STRONG AUTH (`grantsFromClaims`), so these
 *    sessions carry a strong `amr` (WebAuthn `hwk`); the member deliberately does not.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());

// Strong-auth sessions (amr: hwk) so the pmo/admin authorities are actually granted, not withheld.
const STRONG = { amr: ["hwk"] };
const strongAdmin = () => adminCookie(STRONG);
const pmoCookie = () => cookie({ sub: "u-pmo", name: "Pat PMO", email: "pat@x.io", roles: ["omni-pmo"], ...STRONG });

/** Run `fn` with real RBAC in force: leave demo mode and pin the claim→role mapping, then restore. */
async function withRealRbac(fn: () => Promise<void>): Promise<void> {
  const keys = ["OIDC_ISSUER_URL", "OIDC_ADMIN_ROLES", "OIDC_PMO_ROLES"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
  process.env["OIDC_PMO_ROLES"] = "omni-pmo";
  try {
    await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("admin-gated route (GET /ai/providers): admin passes, member and (orthogonal) pmo are 403", async () => {
  await withRealRbac(async () => {
    assert.equal((await h.req("/ai/providers", { cookie: strongAdmin() })).status, 200);
    assert.equal((await h.req("/ai/providers", { cookie: memberCookie() })).status, 403);
    // A pure PMO must NOT clear an admin gate — proves the authorities are orthogonal, not ranked.
    assert.equal((await h.req("/ai/providers", { cookie: pmoCookie() })).status, 403);
  });
});

test("pmo-gated write (PUT /views): pmo passes the gate, member and (orthogonal) admin are 403", async () => {
  await withRealRbac(async () => {
    // Not asserting the exact success code (that's body-validation's job) — only that the gate let
    // the PMO through (any non-403), while the two non-PMO principals are rejected at the gate.
    const pmo = await h.req("/views", { cookie: pmoCookie(), method: "PUT", body: { views: [] } });
    assert.notEqual(pmo.status, 403);
    assert.equal((await h.req("/views", { cookie: memberCookie(), method: "PUT", body: { views: [] } })).status, 403);
    // A pure admin must NOT clear a PMO gate — the mirror of the case above.
    assert.equal((await h.req("/views", { cookie: strongAdmin(), method: "PUT", body: { views: [] } })).status, 403);
  });
});

test("reads stay open to any authenticated principal even under real RBAC (GET /views)", async () => {
  await withRealRbac(async () => {
    assert.equal((await h.req("/views", { cookie: memberCookie() })).status, 200);
  });
});
