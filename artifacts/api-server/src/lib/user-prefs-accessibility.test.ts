import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Enable the encrypted artifact store on a temp config dir BEFORE importing anything that reads it — the org
// accessibility DEFAULTS now live as a config def in that store, not a settings key.
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "user-prefs-a11y-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const {
  orgAccessibilityDefaults, setOrgAccessibilityDefaults, effectiveDefaultPrefs, getUserPrefs, setUserPrefs,
  DEFAULT_USER_PREFS,
} = await import("./user-prefs");
const { putDef } = await import("./def-import");

after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("org accessibility default is a config def; a user with no leaf inherits it (over the code default)", () => {
  setOrgAccessibilityDefaults({ highContrast: true, fontScale: 1.25, backgroundColor: "navy" /* invalid → dropped */ });
  // Stored as a minimal partial, sanitised (invalid backgroundColor dropped entirely).
  assert.deepEqual(orgAccessibilityDefaults(), { highContrast: true, fontScale: 1.25 });

  const eff = effectiveDefaultPrefs();
  assert.equal(eff.highContrast, true);       // from org
  assert.equal(eff.fontScale, 1.25);          // from org
  assert.equal(eff.reduceMotion, DEFAULT_USER_PREFS.reduceMotion); // untouched → code default

  const fresh = `acc-${Math.round(performance.now())}`;
  assert.equal(getUserPrefs(fresh).highContrast, true); // no leaf → inherits the org default
});

test("a user WITH a leaf overrides the org default — user-final policy, the org may only DEFAULT", () => {
  setOrgAccessibilityDefaults({ highContrast: true, fontScale: 1.25 });
  const sub = `acc-leaf-${Math.round(performance.now())}`;
  setUserPrefs(sub, { ...DEFAULT_USER_PREFS, highContrast: false, fontScale: 1 });
  assert.equal(getUserPrefs(sub).highContrast, false); // org default does NOT win back
  assert.equal(getUserPrefs(sub).fontScale, 1);
});

test("programme/project may ALSO default (deeper config-def layers fold over the org)", () => {
  setOrgAccessibilityDefaults({ highContrast: true, fontScale: 1.25 });
  // A project-scope accessibility-defaults config def overrides the org for that project.
  putDef({ kind: "project", projectId: "PA" }, {
    id: "project~PA~a11y", kind: "config", name: "a11y", createdBy: "t",
    createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z", rowVersion: 1,
    payload: { id: "accessibility-defaults", values: { fontScale: 1.5 } },
  });
  const scoped = orgAccessibilityDefaults({ projectId: "PA" });
  assert.equal(scoped.fontScale, 1.5);       // project overrides the org
  assert.equal(scoped.highContrast, true);   // inherited from the org layer
  // A different project sees only the org default.
  assert.equal(orgAccessibilityDefaults({ projectId: "PB" }).fontScale, 1.25);
});
