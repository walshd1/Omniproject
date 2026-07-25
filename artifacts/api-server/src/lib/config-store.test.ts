import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  storeView,
  captureVersion,
  createEnvironment,
  activateEnvironment,
  markKnownGood,
  lastKnownGood,
  rollbackTo,
  rollbackToLastKnownGood,
  promote,
  serializeState,
  exportConfig,
  restoreActiveEnvironment,
  __resetConfigStore,
} from "./config-store";
import { __resetConfigCrypto } from "./config-crypto";
import { getSettings, updateSettings } from "./settings";

/**
 * Configuration environments + versioned rollback. In-memory by default; CONFIG_STORE_FILE
 * persists across restarts (simulated here by resetting the in-memory state and reloading).
 */
const tmpFiles: string[] = [];
function tmpFile(): string {
  const f = path.join(os.tmpdir(), `omni-config-store-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return f;
}
afterEach(() => {
  delete process.env["CONFIG_STORE_FILE"];
  __resetConfigStore();
  __resetConfigCrypto();
  for (const f of tmpFiles.splice(0)) {
    try { fs.rmSync(f, { force: true }); } catch { /* ignore */ }
  }
});

test("a fresh store seeds the production env with an initial known-good version", () => {
  const view = storeView();
  assert.equal(view.activeEnv, "production");
  assert.deepEqual(view.environments, ["production"]);
  assert.equal(view.versions.length, 1);
  assert.equal(view.versions[0]!.label, "initial");
  assert.equal(view.versions[0]!.knownGood, true);
  assert.equal(view.persisted, false); // no CONFIG_STORE_FILE
  assert.equal(view.lastKnownGoodId, view.versions[0]!.id);
});

test("captureVersion appends a new (not-known-good) version", () => {
  const before = storeView().versions.length;
  const v = captureVersion("my change");
  assert.equal(v.label, "my change");
  assert.equal(v.knownGood, false);
  assert.equal(storeView().versions.length, before + 1);
});

test("captureVersion without a label omits the label field", () => {
  const v = captureVersion();
  assert.equal(v.label, undefined);
});

test("createEnvironment clones the active env; rejects bad + duplicate names", () => {
  const view = createEnvironment("sandbox");
  assert.ok(view.environments.includes("sandbox"));
  assert.throws(() => createEnvironment("sandbox"), /already exists/);
  assert.throws(() => createEnvironment(""), /Invalid environment name/);
  assert.throws(() => createEnvironment("bad name!"), /Invalid environment name/);
  // Reserved prototype names pass the charset (constructor/prototype) or not (__proto__) but must all be
  // refused — they'd otherwise key the shared `environments` plain object / read as an inherited member.
  for (const bad of ["__proto__", "constructor", "prototype"]) {
    assert.throws(() => createEnvironment(bad), /Invalid environment name/, `create ${bad}`);
    assert.throws(() => activateEnvironment(bad), /Invalid environment name/, `activate ${bad}`);
    assert.throws(() => promote("production", bad), /Invalid environment name/, `promote→${bad}`);
  }
});

test("activateEnvironment switches the active env; rejects an unknown one", () => {
  createEnvironment("staging");
  const view = activateEnvironment("staging");
  assert.equal(view.activeEnv, "staging");
  assert.throws(() => activateEnvironment("ghost"), /Unknown environment/);
});

test("markKnownGood flags a version; rejects an unknown id", () => {
  const v = captureVersion("candidate");
  const view = markKnownGood(v.id);
  assert.equal(view.versions.find((x) => x.id === v.id)!.knownGood, true);
  assert.throws(() => markKnownGood("v9999"), /Unknown version/);
});

test("lastKnownGood returns the most recent known-good for an env, else null", () => {
  const v = captureVersion("cand");
  markKnownGood(v.id);
  assert.equal(lastKnownGood("production")!.id, v.id);
  assert.equal(lastKnownGood("no-such-env"), null);
});

test("rollbackTo applies a target version and records a rollback entry; rejects unknown id", () => {
  const v = captureVersion("target");
  const before = storeView().versions.length;
  const { applied, warnings } = rollbackTo(v.id);
  assert.equal(applied.id, v.id);
  assert.ok(Array.isArray(warnings));
  assert.equal(storeView().versions.length, before + 1);
  assert.throws(() => rollbackTo("v9999"), /Unknown version/);
});

test("rollbackToLastKnownGood uses the last known-good; throws when there is none", () => {
  const good = captureVersion("stable");
  markKnownGood(good.id);
  const { applied } = rollbackToLastKnownGood();
  assert.equal(applied.env, "production");

  // A brand-new env has no known-good version of its own.
  createEnvironment("empty-env");
  activateEnvironment("empty-env");
  assert.throws(() => rollbackToLastKnownGood(), /No known-good version/);
});

test("promote copies one env's config onto another; rejects unknown from/to", () => {
  createEnvironment("sandbox");
  const view = promote("sandbox", "production");
  assert.ok(view.versions.some((v) => v.label === "promoted from sandbox"));
  assert.throws(() => promote("ghost", "production"), /Unknown environment "ghost"/);
  assert.throws(() => promote("sandbox", "ghost"), /Unknown environment "ghost"/);
});

test("promote INTO the active env applies the promoted config to live settings", () => {
  createEnvironment("sandbox");
  // production is active by default; promoting sandbox → production hits the active-env apply path.
  const view = promote("sandbox", "production");
  assert.equal(view.activeEnv, "production");
});

test("serializeState returns parseable JSON reflecting the store", () => {
  const parsed = JSON.parse(serializeState()) as { activeEnv: string; versions: unknown[] };
  assert.equal(parsed.activeEnv, "production");
  assert.ok(Array.isArray(parsed.versions));
});

test("exportConfig produces a bundle + ephemeral key and rotates the internal key", () => {
  const out = exportConfig();
  assert.ok(out.bundle.startsWith("e1."));
  assert.ok(out.exportKey.length > 0);
  assert.equal(out.toVersion, out.fromVersion + 1);
});

test("persistence: state survives a simulated restart via CONFIG_STORE_FILE", () => {
  const file = tmpFile();
  process.env["CONFIG_STORE_FILE"] = file;
  createEnvironment("sandbox");
  const v = captureVersion("persisted");
  assert.equal(storeView().persisted, true);
  assert.ok(fs.existsSync(file));

  // Simulate a restart: drop in-memory state, reload from the sealed file.
  __resetConfigStore();
  const reloaded = storeView();
  assert.ok(reloaded.environments.includes("sandbox"));
  assert.ok(reloaded.versions.some((x) => x.id === v.id && x.label === "persisted"));
});

test("restoreActiveEnvironment: an admin's runtime config survives a restart (re-applied to live settings)", () => {
  const file = tmpFile();
  process.env["CONFIG_STORE_FILE"] = file;
  try {
    // Admin changes config through the runtime path, then captures it into the active env (as the
    // settings API does), which persists to the sealed store file.
    updateSettings({ backendSource: "jira-only" });
    captureVersion("admin change");
    assert.equal(getSettings().backendSource, "jira-only");

    // Simulate a restart: settings re-seed from env/config-dir (default), and the store drops its RAM.
    updateSettings({ backendSource: "all" });
    __resetConfigStore();
    assert.equal(getSettings().backendSource, "all"); // without the boot hook the runtime change is lost

    // The boot hook re-applies the persisted active environment onto live settings.
    const r = restoreActiveEnvironment();
    assert.equal(r.restored, true);
    assert.equal(r.env, "production");
    assert.equal(getSettings().backendSource, "jira-only");
  } finally {
    updateSettings({ backendSource: "all" }); // don't leak into sibling tests
  }
});

test("restoreActiveEnvironment: no-op when persistence is off or nothing persisted", () => {
  assert.equal(restoreActiveEnvironment().restored, false); // no CONFIG_STORE_FILE
  const file = tmpFile();
  process.env["CONFIG_STORE_FILE"] = file; // path set but no file written yet
  assert.equal(restoreActiveEnvironment().restored, false);
});

test("persistence: a corrupt store file is tolerated (starts fresh)", () => {
  const file = tmpFile();
  process.env["CONFIG_STORE_FILE"] = file;
  fs.writeFileSync(file, "this is not json");
  const view = storeView(); // load() fails → fresh default state
  assert.equal(view.activeEnv, "production");
  assert.equal(view.environments.length, 1);
});
