import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the RESOLVED scheduling seam — GET /api/scheduling/resolved returns the working-time
 * policy folded across scopes (org settings compat layer < programme/project/user `config` defs), the
 * migration seam that replaces reading org `settings.scheduling` straight off the settings blob.
 */

// The sealed store must be on a temp dir so putDef persists where the booted app reads it.
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "scheduling-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => {
  h?.close();
  const { updateSettings, DEFAULT_SCHEDULING } = await import("../lib/settings");
  updateSettings({ scheduling: { ...DEFAULT_SCHEDULING } });
  fs.rmSync(CONFIG_DIR, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /scheduling/resolved returns the org calendar when no config defs exist", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ scheduling: { hoursPerDay: 7, workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] } });
  const r = await h.req("/scheduling/resolved", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).scheduling, { hoursPerDay: 7, workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] });
});

test("a project-scoped scheduling config def overrides the org calendar for that project only", async () => {
  const { putDef } = await import("../lib/def-import");
  putDef({ kind: "project", projectId: "PROJ" }, {
    id: "project~PROJ~sched", kind: "config", name: "sched", createdBy: "t",
    createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z", rowVersion: 1,
    payload: { id: "scheduling", values: { hoursPerDay: 6 } },
  });
  // The project sees the override folded over the org calendar (holidays inherited).
  const scoped = await json(await h.req("/scheduling/resolved?projectId=PROJ", { cookie: adminCookie() }));
  assert.equal(scoped.scheduling.hoursPerDay, 6);
  assert.deepEqual(scoped.scheduling.holidays, ["2026-12-25"]);
  // A different project is untouched — still the org calendar.
  const other = await json(await h.req("/scheduling/resolved?projectId=OTHER", { cookie: adminCookie() }));
  assert.equal(other.scheduling.hoursPerDay, 7);
});

test("the resolved endpoint requires auth", async () => {
  const r = await h.req("/scheduling/resolved");
  assert.equal(r.status, 401);
});
