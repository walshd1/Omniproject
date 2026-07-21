import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/screen-layouts.ts over the REAL app after the FOLD (roadmap X.10): a saved layout now rides on the
 * screen def in the def store, so this legacy `screenLayouts` slice is READ-ONLY save-wise — GET stays open
 * (migration bridge), and the only permitted write is DRAINING to `{}`; a non-empty write is 410 Gone. Writes
 * stay pmo-gated.
 */
let h: Harness;
const ADMIN = adminCookie();

before(async () => {
  h = await startHarness();
});
after(() => h?.close());

afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ screenLayouts: {} });
});

const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });

test("GET /screen-layouts returns the (empty by default) layout map", async () => {
  const r = await req("/screen-layouts");
  assert.equal(r.status, 200);
  const body = (await r.json()) as { screenLayouts: Record<string, unknown> };
  assert.deepEqual(body.screenLayouts, {});
});

test("the legacy PUT /screen-layouts is retired — a non-empty write is 410, draining to {} is allowed", async () => {
  const screenLayouts = { "resource-planning": { order: ["over-capacity", "capacity-grid"], spans: { "capacity-grid": 8 }, hidden: ["what-if-allocation"] } };
  assert.equal((await req("/screen-layouts", { method: "PUT", body: { screenLayouts } })).status, 410);
  assert.equal((await req("/screen-layouts", { method: "PUT", body: { screenLayouts: {} } })).status, 200);
});

test("a legacy screenLayouts entry still reads back (migration bridge)", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ screenLayouts: { "resource-planning": { order: ["a", "b"] } } });
  const readBack = (await (await req("/screen-layouts")).json()) as { screenLayouts: Record<string, unknown> };
  assert.ok(readBack.screenLayouts["resource-planning"]);
});

test("screen-layouts write is gated to pmo (reads stay open) under real RBAC", async () => {
  // The harness runs in demo mode (every session holds all grants); flip out of demo so the gate bites.
  const prev = process.env["OIDC_ISSUER_URL"];
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    const write = await h.req("/screen-layouts", { cookie: memberCookie(), method: "PUT", body: { screenLayouts: {} } });
    assert.equal(write.status, 403); // a non-pmo member cannot rearrange shared screens
    const read = await h.req("/screen-layouts", { cookie: memberCookie() });
    assert.equal(read.status, 200); // …but reads remain open
  } finally {
    if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev;
  }
});
