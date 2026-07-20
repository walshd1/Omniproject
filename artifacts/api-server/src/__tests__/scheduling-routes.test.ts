import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the working-time policy in the composition model. The policy is a scope-layered
 * `scheduling` config def (no settings key):
 *  - GET  /api/scheduling/resolved — the folded policy for the engine (any authed user).
 *  - GET  /api/scheduling — the org-scope values the admin editor seeds from (admin/PMO).
 *  - PUT  /api/scheduling — write the org-scope config def (admin/PMO), through the validated def path.
 */

// The sealed store must be on a temp dir so the config def persists where the booted app reads it.
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "scheduling-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /scheduling/resolved returns the code default before anything is authored", async () => {
  const r = await h.req("/scheduling/resolved", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).scheduling, { hoursPerDay: 8, workingWeekdays: [1, 2, 3, 4, 5], holidays: [] });
});

test("PUT /scheduling writes the org config def; GET reflects it and resolved folds it in", async () => {
  const put = await h.req("/scheduling", { method: "PUT", cookie: adminCookie(), body: { scheduling: { hoursPerDay: 7, workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] } } });
  assert.equal(put.status, 200);
  assert.deepEqual((await json(put)).scheduling, { hoursPerDay: 7, workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] });

  // The admin editor read reflects the org value…
  assert.deepEqual((await json(await h.req("/scheduling", { cookie: adminCookie() }))).scheduling, { hoursPerDay: 7, workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] });
  // …and the engine's resolved read folds it over the default.
  assert.equal((await json(await h.req("/scheduling/resolved", { cookie: memberCookie() }))).scheduling.hoursPerDay, 7);

  // A second PUT updates the singleton in place (not a duplicate).
  const put2 = await h.req("/scheduling", { method: "PUT", cookie: adminCookie(), body: { scheduling: { hoursPerDay: 6 } } });
  assert.equal(put2.status, 200);
  assert.equal((await json(put2)).scheduling.hoursPerDay, 6);
});

test("PUT /scheduling rejects invalid working-time values → 400", async () => {
  assert.equal((await h.req("/scheduling", { method: "PUT", cookie: adminCookie(), body: { scheduling: { hoursPerDay: 0 } } })).status, 400);
  assert.equal((await h.req("/scheduling", { method: "PUT", cookie: adminCookie(), body: { scheduling: { workingWeekdays: [] } } })).status, 400);
  assert.equal((await h.req("/scheduling", { method: "PUT", cookie: adminCookie(), body: { scheduling: { holidays: ["25/12/2026"] } } })).status, 400);
});

test("the resolved endpoint requires auth", async () => {
  assert.equal((await h.req("/scheduling/resolved")).status, 401);
});
