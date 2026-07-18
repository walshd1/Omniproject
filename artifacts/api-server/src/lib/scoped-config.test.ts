import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Enable the encrypted artifact store on a temp config dir BEFORE importing anything that reads it.
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "scoped-config-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const { resolveScopedConfig, configDefLayers, resolveConfig, resolveScheduling } = await import("./scoped-config");
const { putDef } = await import("./def-import");
const { updateSettings, DEFAULT_SCHEDULING } = await import("./settings");

const now = "2026-07-18T00:00:00.000Z";

/** Shape a StoredDef row carrying a `config` payload at some scope. */
function configRow(storageId: string, id: string, values: Record<string, unknown>) {
  return { id: storageId, kind: "config" as const, name: id, createdBy: "t", createdAt: now, updatedAt: now, rowVersion: 1, payload: { id, values } };
}

after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("resolveScopedConfig folds layers base → leaf, later wins, deep-merges objects", () => {
  const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2] };
  const out = resolveScopedConfig(base, [
    { a: 2, nested: { y: 9 } },           // overrides a + one nested key, keeps nested.x
    { list: [3] },                        // keyless array → replaces whole
    undefined,                            // skipped
    "not-an-object",                      // skipped (only object layers apply)
  ]);
  assert.deepEqual(out, { a: 2, nested: { x: 1, y: 9 }, list: [3] });
});

test("resolveScopedConfig with no layers returns the base unchanged", () => {
  const base = { hoursPerDay: 8 };
  assert.deepEqual(resolveScopedConfig(base, []), base);
});

test("configDefLayers gathers a logical id across scopes in precedence order (system→…→user)", () => {
  putDef({ kind: "org" }, configRow("org~cfg", "demo", { level: "org", shared: "org" }));
  putDef({ kind: "project", projectId: "P1" }, configRow("project~P1~cfg", "demo", { level: "project" }));
  putDef({ kind: "user", sub: "U1" }, configRow("user~U1~cfg", "demo", { level: "user" }));
  // A config def for a DIFFERENT logical id must not leak in.
  putDef({ kind: "org" }, configRow("org~other", "unrelated", { level: "nope" }));

  const layers = configDefLayers("demo", { projectId: "P1", sub: "U1" });
  assert.deepEqual(layers, [{ level: "org", shared: "org" }, { level: "project" }, { level: "user" }]);
  // Fold them: nearest (user) wins on `level`, org-only key survives.
  assert.deepEqual(resolveConfig("demo", { level: "code", shared: "code" }, { projectId: "P1", sub: "U1" }), { level: "user", shared: "org" });
});

test("resolveScheduling: org settings.scheduling is the compat layer beneath a project config def override", () => {
  try {
    updateSettings({ scheduling: { hoursPerDay: 7, workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] } });
    // No scopes → just the org compat layer over the code default.
    assert.deepEqual(resolveScheduling(), { hoursPerDay: 7, workingWeekdays: [1, 2, 3, 4, 5], holidays: ["2026-12-25"] });

    // A project-scoped scheduling config def overrides the org calendar for that project only.
    putDef({ kind: "project", projectId: "PX" }, configRow("project~PX~sched", "scheduling", { hoursPerDay: 6, workingWeekdays: [1, 2, 3, 4] }));
    const eff = resolveScheduling({ projectId: "PX" });
    assert.equal(eff.hoursPerDay, 6);                      // from the project config def
    assert.deepEqual(eff.workingWeekdays, [1, 2, 3, 4]);   // from the project config def
    assert.deepEqual(eff.holidays, ["2026-12-25"]);        // untouched → inherited from the org compat layer

    // A different project sees only the org calendar (no config def of its own).
    assert.equal(resolveScheduling({ projectId: "PY" }).hoursPerDay, 7);
  } finally {
    updateSettings({ scheduling: { ...DEFAULT_SCHEDULING } });
  }
});
