import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refreshConfigDir, configBackupInfo, clearConfigBackup } from "./config-refresh";
import { getBackend, clearVendorOverlay } from "@workspace/backend-catalogue";

/**
 * Config-dir hot-reload: backs the directory up to `.old` before loading, and
 * auto-reverts to that backup if the new load reports any file error — so a bad
 * hand-edit can never leave the gateway running on a half-applied broken config.
 */

const JIRA_OVERRIDE = {
  id: "jira",
  label: "Jira (our tenant)",
  docsUrl: "https://example.test/jira",
  verification: "catalogued",
  via: "HTTP",
  requiredEnv: ["JIRA_INSTANCE_URL"],
  capabilities: { issues: true },
  authHeader: "=Bearer x",
  actions: { list_projects: { method: "GET", url: "https://example.test" } },
};

function makeConfigDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omni-config-refresh-"));
  const vendorFile = path.join(root, "vendors", "backends", "jira.json");
  fs.mkdirSync(path.dirname(vendorFile), { recursive: true });
  fs.writeFileSync(vendorFile, JSON.stringify(JIRA_OVERRIDE));
  return root;
}

function cleanup(dir: string): void {
  clearVendorOverlay();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(`${dir}.old`, { recursive: true, force: true });
}

test("refreshConfigDir is a clean no-op result when OMNI_CONFIG_DIR isn't set", () => {
  const result = refreshConfigDir(undefined);
  assert.equal(result.ok, false);
  assert.equal(result.backedUp, false);
  assert.equal(result.reverted, false);
});

test("a clean reload backs the directory up and reports success", () => {
  clearVendorOverlay();
  const dir = makeConfigDir();
  const result = refreshConfigDir(dir);
  assert.equal(result.ok, true);
  assert.equal(result.backedUp, true);
  assert.equal(result.reverted, false);
  assert.deepEqual(result.summary.errors, []);
  assert.equal(getBackend("jira")?.label, "Jira (our tenant)");
  assert.ok(fs.existsSync(`${dir}.old`), "the .old backup should now exist");
  cleanup(dir);
});

test("a broken edit is auto-reverted to the last-known-good backup", () => {
  clearVendorOverlay();
  const dir = makeConfigDir();
  // Establish a good baseline + backup.
  const first = refreshConfigDir(dir);
  assert.equal(first.ok, true);

  // Corrupt the vendor file in place (simulating a bad hand-edit) — invalid JSON.
  fs.writeFileSync(path.join(dir, "vendors", "backends", "jira.json"), "{ not valid json");

  const second = refreshConfigDir(dir);
  assert.equal(second.ok, false);
  assert.equal(second.reverted, true);
  // The revert re-loaded the GOOD backup, so the reverted state is clean again.
  assert.deepEqual(second.summary.errors, []);
  assert.equal(getBackend("jira")?.label, "Jira (our tenant)");
  // The on-disk directory itself was restored, not just the in-memory overlay.
  const restored = JSON.parse(fs.readFileSync(path.join(dir, "vendors", "backends", "jira.json"), "utf8"));
  assert.equal(restored.label, "Jira (our tenant)");
  cleanup(dir);
});

test("configBackupInfo reports presence/age; clearConfigBackup removes it", () => {
  clearVendorOverlay();
  const dir = makeConfigDir();
  assert.deepEqual(configBackupInfo(dir), { present: false, ageDays: null, stale: false });

  refreshConfigDir(dir);
  const info = configBackupInfo(dir);
  assert.equal(info.present, true);
  assert.ok(info.ageDays !== null && info.ageDays < 1);
  assert.equal(info.stale, false);

  // Backdate the backup past the 30-day threshold.
  const old = Date.now() - 31 * 86_400_000;
  fs.utimesSync(`${dir}.old`, old / 1000, old / 1000);
  assert.equal(configBackupInfo(dir).stale, true);

  assert.equal(clearConfigBackup(dir), true);
  assert.deepEqual(configBackupInfo(dir), { present: false, ageDays: null, stale: false });
  assert.equal(clearConfigBackup(dir), false); // nothing left to clear
  cleanup(dir);
});

test("configBackupInfo / clearConfigBackup are no-ops with no dir configured", () => {
  assert.deepEqual(configBackupInfo(undefined), { present: false, ageDays: null, stale: false });
  assert.equal(clearConfigBackup(undefined), false);
});
