import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/dashboards.ts over the REAL app. Dashboards are benign, customer-level presentation
 * config any authenticated user may read/save, so there is no role branch to exercise — the
 * reachable branches are the read, the valid save, and the settings-validation 400.
 */
let h: Harness;
const ADMIN = adminCookie();

before(async () => {
  h = await startHarness();
});
after(() => h?.close());

afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ dashboards: [] });
});

const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });

test("GET /dashboards returns the (empty by default) dashboard list", async () => {
  const r = await req("/dashboards");
  assert.equal(r.status, 200);
  const body = (await r.json()) as { dashboards: unknown[] };
  assert.ok(Array.isArray(body.dashboards));
});

test("PUT /dashboards saves a valid dashboard and reads it back", async () => {
  const dashboards = [{ id: "d1", name: "Delivery", widgets: [{ id: "w1", type: "burndown" }] }];
  const r = await req("/dashboards", { method: "PUT", body: { dashboards } });
  assert.equal(r.status, 200);
  const saved = (await r.json()) as { dashboards: { id: string }[] };
  assert.deepEqual(saved.dashboards.map((d) => d.id), ["d1"]);
  const readBack = (await (await req("/dashboards")).json()) as { dashboards: { id: string }[] };
  assert.deepEqual(readBack.dashboards.map((d) => d.id), ["d1"]);
});

test("PUT /dashboards with a non-array payload → 400 (settings validation)", async () => {
  const r = await req("/dashboards", { method: "PUT", body: { dashboards: "not-an-array" } });
  assert.equal(r.status, 400);
  const body = (await r.json()) as { error: string };
  assert.ok(/array/.test(body.error));
});

test("dashboards write is gated to pmo (reads stay open) under real RBAC", async () => {
  // The harness runs in demo mode (no auth configured), where every session holds all grants.
  // Flip out of demo (isDemoAuth checks OIDC_ISSUER_URL live) so the RBAC gate is actually enforced.
  const prev = process.env["OIDC_ISSUER_URL"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    const write = await h.req("/dashboards", { cookie: memberCookie(), method: "PUT", body: { dashboards: [] } });
    assert.equal(write.status, 403); // a non-pmo member cannot overwrite shared dashboards
    const read = await h.req("/dashboards", { cookie: memberCookie() });
    assert.equal(read.status, 200); // …but reads remain open
  } finally {
    if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev;
  }
});
