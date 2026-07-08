import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the company-nomenclature label overrides (routes/labels.ts, premium `labels`).
 * GET /labels + GET /labels/presets are public (mounted before requireAuth); PUT /labels and
 * POST /labels/apply-preset are admin + entitlement gated. During the pre-community period every
 * premium feature is entitled, so the entitlement gate passes and the save/apply + error branches
 * (bad overrides → 400, unknown preset → 404, a real preset → 200) are all reachable.
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());

afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ labelOverrides: {} });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /labels: public; effective overrides + the overridable catalogue", async () => {
  const r = await h.req("/labels");
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.equal(typeof b.entitled, "boolean");
  assert.ok(Array.isArray(b.catalog));
});

test("PUT /labels: a valid override saves and takes effect", async () => {
  const r = await h.req("/labels", { method: "PUT", cookie: adminCookie(), body: { overrides: { "term.project": "Engagement" } } });
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.equal(b.saved, true);
  assert.equal(b.overrides["term.project"], "Engagement");
  // Reflected on the public read.
  const back = await json(await h.req("/labels"));
  assert.equal(back.overrides["term.project"], "Engagement");
});

test("PUT /labels: a non-string override value → 400", async () => {
  const r = await h.req("/labels", { method: "PUT", cookie: adminCookie(), body: { overrides: { "term.project": 42 } } });
  assert.equal(r.status, 400);
  assert.ok((await json(r)).error);
});

test("GET /labels/presets: public; the per-vendor nomenclature presets", async () => {
  const r = await h.req("/labels/presets");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray((await json(r)).presets));
});

test("POST /labels/apply-preset: an unknown backend → 404", async () => {
  const r = await h.req("/labels/apply-preset", { method: "POST", cookie: adminCookie(), body: { backendId: "no-such-backend" } });
  assert.equal(r.status, 404);
  assert.match((await json(r)).error, /no nomenclature preset/i);
});

test("POST /labels/apply-preset: a real vendor preset applies → 200", async () => {
  const presets = (await json(await h.req("/labels/presets"))).presets as { backendId: string }[];
  assert.ok(presets.length > 0, "expected at least one nomenclature preset");
  const backendId = presets[0]!.backendId;
  const r = await h.req("/labels/apply-preset", { method: "POST", cookie: adminCookie(), body: { backendId } });
  assert.equal(r.status, 200);
  const b = await json(r);
  assert.equal(b.saved, true);
  assert.equal(typeof b.overrides, "object");
});
