import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/capabilities.ts over the REAL app. Covers the availability read, the
 * admin/PMO view-curation read + write (requireAdminOrPmo → next, since demo auth
 * grants the admin role), the settings-validation 400 on a bad hidden-field list,
 * and the field manifest. The 502 catch blocks depend on a broker read fault (the
 * demo broker never throws on reads) and are unreachable here.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ hiddenFields: [] });
});

const req = (path: string, opts: Parameters<Harness["req"]>[1] = {}) => h.req(path, { cookie: ADMIN, ...opts });

test("GET /availability reports what the connected backend surfaces", async () => {
  const r = await req("/availability");
  assert.equal(r.status, 200);
  const body = (await r.json()) as Record<string, unknown>;
  assert.ok(body && typeof body === "object");
});

test("GET /availability/curation returns the (empty by default) hidden-field list", async () => {
  const r = await req("/availability/curation");
  assert.equal(r.status, 200);
  const body = (await r.json()) as { hiddenFields: string[] };
  assert.ok(Array.isArray(body.hiddenFields));
});

test("PATCH /availability/curation persists a valid hidden-field list and reads it back", async () => {
  const r = await req("/availability/curation", { method: "PATCH", body: { hiddenFields: ["storyPoints", "budget"] } });
  assert.equal(r.status, 200);
  const body = (await r.json()) as { hiddenFields: string[] };
  assert.deepEqual(body.hiddenFields, ["storyPoints", "budget"]);
  const readBack = (await (await req("/availability/curation")).json()) as { hiddenFields: string[] };
  assert.deepEqual(readBack.hiddenFields, ["storyPoints", "budget"]);
});

test("PATCH /availability/curation 400s when hiddenFields is not an array of strings", async () => {
  const r = await req("/availability/curation", { method: "PATCH", body: { hiddenFields: "not-an-array" } });
  assert.equal(r.status, 400);
  const body = (await r.json()) as { error: string };
  assert.match(body.error, /hiddenFields/);
});

test("GET /fields/manifest reconciles the backend fields against the registry", async () => {
  const r = await req("/fields/manifest");
  assert.equal(r.status, 200);
  const body = (await r.json()) as Record<string, unknown>;
  assert.ok(body && typeof body === "object");
});
