import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/screen-defs.ts over the REAL app. Org screen defs are the encrypted per-deployment store a PMO
 * overrides/extends the built-in screen catalogue with. READ open (the SPA merges them); WRITE gated to
 * `pmo`. Reachable branches: read default, valid save round-trip, validation 400, RBAC gate.
 */
let h: Harness;
const ADMIN = adminCookie();

before(async () => {
  h = await startHarness();
});
after(() => h?.close());

afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ screenDefs: [] });
});

const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });

test("GET /screen-defs returns the (empty by default) list", async () => {
  const r = await req("/screen-defs");
  assert.equal(r.status, 200);
  const body = (await r.json()) as { screenDefs: unknown[] };
  assert.deepEqual(body.screenDefs, []);
});

test("PUT /screen-defs saves an org screen def (overriding a default id) and reads it back", async () => {
  const screenDefs = [{ id: "budget-plans", label: "Our Budgets", panels: [{ id: "t", kind: "table", source: { url: "/api/budget-plans/rows" } }] }];
  const r = await req("/screen-defs", { method: "PUT", body: { screenDefs } });
  assert.equal(r.status, 200);
  const saved = (await r.json()) as { screenDefs: { id: string; label: string }[] };
  assert.deepEqual(saved.screenDefs.map((s) => s.id), ["budget-plans"]);
  assert.equal(saved.screenDefs[0]!.label, "Our Budgets");
});

test("PUT /screen-defs with a malformed def → 400 (settings validation)", async () => {
  const r = await req("/screen-defs", { method: "PUT", body: { screenDefs: [{ label: "no id", panels: [] }] } });
  assert.equal(r.status, 400);
  const body = (await r.json()) as { error: string };
  assert.ok(/id/.test(body.error));
});

test("screen-defs write is gated to pmo (reads stay open) under real RBAC", async () => {
  const prev = process.env["OIDC_ISSUER_URL"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    const write = await h.req("/screen-defs", { cookie: memberCookie(), method: "PUT", body: { screenDefs: [] } });
    assert.equal(write.status, 403); // a non-pmo member cannot rewrite the org's screens
    const read = await h.req("/screen-defs", { cookie: memberCookie() });
    assert.equal(read.status, 200); // …but reads remain open
  } finally {
    if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev;
  }
});
