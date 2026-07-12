import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, cookie, memberCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the company-nomenclature label overrides (routes/labels.ts). Nomenclature is a
 * standard PMO/admin governance knob, not a premium gate. GET /labels + GET /labels/presets are
 * public (mounted before requireAuth); PUT /labels and POST /labels/apply-preset are PMO-or-admin.
 * Covers: both PMO and admin can write, a non-authority member is refused (403), and the
 * save/apply + error branches (bad overrides → 400, unknown preset → 404, a real preset → 200).
 */
// Strong-auth PMO (amr: hwk) so the pmo authority is actually granted under real RBAC, not withheld.
const STRONG = { amr: ["hwk"] };
const pmoCookie = () => cookie({ sub: "u-pmo", name: "Pat PMO", email: "pat@x.io", roles: ["omni-pmo"], ...STRONG });

/** Run `fn` with real RBAC in force (leave demo mode, pin the claim→role mapping), then restore. */
async function withRealRbac(fn: () => Promise<void>): Promise<void> {
  const keys = ["OIDC_ISSUER_URL", "OIDC_ADMIN_ROLES", "OIDC_PMO_ROLES"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
  process.env["OIDC_PMO_ROLES"] = "omni-pmo";
  try { await fn(); } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
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

test("PUT /labels: under real RBAC both PMO and admin can write; a plain member is refused (403)", async () => {
  await withRealRbac(async () => {
    // Nomenclature is a PMO-OR-admin union gate — either authority clears it, a member does not.
    const pmo = await h.req("/labels", { method: "PUT", cookie: pmoCookie(), body: { overrides: { "term.project": "Engagement" } } });
    assert.equal(pmo.status, 200);
    const admin = await h.req("/labels", { method: "PUT", cookie: adminCookie(STRONG), body: { overrides: { "term.project": "Engagement" } } });
    assert.equal(admin.status, 200);
    const member = await h.req("/labels", { method: "PUT", cookie: memberCookie(), body: { overrides: { "term.project": "Engagement" } } });
    assert.equal(member.status, 403);
  });
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
