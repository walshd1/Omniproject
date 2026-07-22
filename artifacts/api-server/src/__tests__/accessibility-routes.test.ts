import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the ORG accessibility DEFAULTS in the composition model — a scope-layered
 * `accessibility-defaults` config def (no settings key):
 *  - GET/PUT /api/accessibility-defaults (admin/PMO) — read + set the org default (partial UserPrefs).
 *  - the value surfaces beneath a fresh user at GET /api/me/prefs (`orgDefaults`), user-final on top.
 */

process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "accessibility-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /accessibility-defaults is empty before anything is set", async () => {
  const r = await h.req("/accessibility-defaults", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).accessibilityDefaults, {});
});

test("PUT sets the org default (sanitised to a partial); GET + /me/prefs reflect it", async () => {
  const put = await h.req("/accessibility-defaults", { method: "PUT", cookie: adminCookie(), body: { highContrast: true, fontScale: 1.25, backgroundColor: "navy" } });
  assert.equal(put.status, 200);
  // Invalid backgroundColor dropped; only the valid named fields kept (minimal partial).
  assert.deepEqual((await json(put)).accessibilityDefaults, { highContrast: true, fontScale: 1.25 });

  assert.deepEqual((await json(await h.req("/accessibility-defaults", { cookie: adminCookie() }))).accessibilityDefaults, { highContrast: true, fontScale: 1.25 });

  // A signed-in user with no saved prefs sees the org default surfaced as `orgDefaults` and folded into `prefs`.
  const me = await json(await h.req("/me/prefs", { cookie: memberCookie() }));
  assert.equal(me.orgDefaults.highContrast, true);
  assert.equal(me.prefs.highContrast, true);
  assert.equal(me.stored, false);
});

test("the resolved default is not a floor: a user's own leaf wins (user-final policy)", async () => {
  await h.req("/accessibility-defaults", { method: "PUT", cookie: adminCookie(), body: { highContrast: true } });
  // The signed-in member saves their OWN prefs turning it off — their leaf wins over the org default.
  await h.req("/me/prefs", { method: "PUT", cookie: memberCookie(), body: { ...{ fontScale: 1 }, highContrast: false } });
  const me = await json(await h.req("/me/prefs", { cookie: memberCookie() }));
  assert.equal(me.prefs.highContrast, false);
  assert.equal(me.stored, true);
});
