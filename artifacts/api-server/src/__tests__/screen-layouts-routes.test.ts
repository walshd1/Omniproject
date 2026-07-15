import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/screen-layouts.ts over the REAL app. Screen layouts are customer-level presentation config:
 * any authenticated session may READ them, but a WRITE is gated to `pmo` so a viewer / read-only token
 * can't rearrange shared screens. The collection is an OBJECT (keyed by screen id), so the reachable
 * branches are the read (default `{}`), a valid save, the settings-validation 400, and the RBAC gate.
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

test("PUT /screen-layouts saves a valid layout and reads it back", async () => {
  const screenLayouts = { "resource-planning": { order: ["over-capacity", "capacity-grid"], spans: { "capacity-grid": 8 }, hidden: ["what-if-allocation"] } };
  const r = await req("/screen-layouts", { method: "PUT", body: { screenLayouts } });
  assert.equal(r.status, 200);
  const saved = (await r.json()) as { screenLayouts: Record<string, { order: string[]; spans: Record<string, number>; hidden: string[] }> };
  assert.deepEqual(saved.screenLayouts["resource-planning"], { order: ["over-capacity", "capacity-grid"], spans: { "capacity-grid": 8 }, hidden: ["what-if-allocation"] });
  const readBack = (await (await req("/screen-layouts")).json()) as { screenLayouts: Record<string, unknown> };
  assert.ok(readBack.screenLayouts["resource-planning"]);
});

test("PUT /screen-layouts with a non-object payload → 400 (settings validation)", async () => {
  const r = await req("/screen-layouts", { method: "PUT", body: { screenLayouts: ["nope"] } });
  assert.equal(r.status, 400);
  const body = (await r.json()) as { error: string };
  assert.ok(/object/.test(body.error));
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
