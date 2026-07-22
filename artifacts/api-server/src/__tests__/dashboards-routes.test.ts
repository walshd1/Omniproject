import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/dashboards.ts over the REAL app. Dashboards are now DEFINITIONS authored through the importer
 * (X.10), so this LEGACY settings route is read-only plus a single permitted write — draining the slice to
 * `[]` (the migration). A non-empty write is a retired bypass → 410. We cover: the read, the allowed drain,
 * the 410 on a real dashboard write, and the pmo write-gate.
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

test("PUT /dashboards with real dashboards is a retired bypass → 410 (author via the importer)", async () => {
  const dashboards = [{ id: "d1", name: "Delivery", widgets: [{ id: "w1", type: "burndown" }] }];
  const r = await req("/dashboards", { method: "PUT", body: { dashboards } });
  assert.equal(r.status, 410);
  const body = (await r.json()) as { error: string };
  assert.ok(/importer|definition/i.test(body.error));
  // …and nothing was persisted through the retired path.
  const readBack = (await (await req("/dashboards")).json()) as { dashboards: unknown[] };
  assert.deepEqual(readBack.dashboards, []);
});

test("PUT /dashboards accepts the empty drain (the one-time migration to definitions)", async () => {
  const r = await req("/dashboards", { method: "PUT", body: { dashboards: [] } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { dashboards: unknown[] };
  assert.deepEqual(body.dashboards, []);
});

test("PUT /dashboards with a non-array payload is refused (410, not a write)", async () => {
  const r = await req("/dashboards", { method: "PUT", body: { dashboards: "not-an-array" } });
  assert.equal(r.status, 410);
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
