import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfigDir } from "../lib/config-dir";
import { buildConfigBundle } from "../lib/config-bundle";
import { sealConfig } from "../lib/config-crypto";
import { buildSnapshot } from "../lib/config-snapshot";
import { getSettings } from "../lib/settings";
import { getFieldRules } from "../lib/ruleset";
import { getBackend, backendCatalogue, clearVendorOverlay } from "@workspace/backend-catalogue";

/**
 * Config-directory loader tests — a deployment's folder of JSON (vendor overlay +
 * config.json) is read at boot, validated, and applied; bad files are skipped, not
 * fatal. The vendor overlay must flow through the catalogue accessors.
 */

/** Write a folder-of-JSON config dir under a temp root and return its path. */
function makeConfigDir(files: Record<string, unknown>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omni-config-"));
  for (const [rel, data] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, JSON.stringify(data));
  }
  return root;
}

test("loadConfigDir is a no-op when no directory is set", () => {
  clearVendorOverlay();
  const summary = loadConfigDir(undefined);
  assert.equal(summary.present, false);
  assert.equal(summary.configApplied, false);
});

test("a deployment vendor JSON overrides a shipped backend via the catalogue", () => {
  clearVendorOverlay();
  const dir = makeConfigDir({
    "vendors/backends/jira.json": {
      id: "jira",
      label: "Jira (our tenant)", // override the shipped label
      docsUrl: "https://example.test/jira",
      verification: "catalogued",
      via: "HTTP",
      requiredEnv: ["JIRA_INSTANCE_URL"],
      capabilities: { issues: true },
      authHeader: "=Bearer x",
      actions: { list_projects: { method: "GET", url: "https://example.test" } },
    },
  });
  const summary = loadConfigDir(dir);
  assert.equal(summary.vendors["backends"], 1);
  assert.equal(summary.errors.length, 0, summary.errors.join("; "));
  assert.equal(getBackend("jira")?.label, "Jira (our tenant)");
  assert.ok(backendCatalogue().some((b) => b.label === "Jira (our tenant)"));
  clearVendorOverlay();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an invalid vendor JSON is recorded as an error, not loaded", () => {
  clearVendorOverlay();
  const dir = makeConfigDir({
    "vendors/backends/broken.json": { id: "broken" }, // missing required fields
  });
  const summary = loadConfigDir(dir);
  assert.equal(summary.vendors["backends"], 0);
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0]!, /broken\.json/);
  assert.equal(getBackend("broken"), undefined);
  clearVendorOverlay();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a non-existent OMNI_CONFIG_DIR is reported, not thrown", () => {
  clearVendorOverlay();
  const summary = loadConfigDir(path.join(os.tmpdir(), "definitely-not-here-omni"));
  assert.equal(summary.present, false);
  assert.equal(summary.errors.length, 1);
});

test("rulesets/field-rules.json is applied from the config dir", () => {
  clearVendorOverlay();
  const dir = makeConfigDir({
    "rulesets/field-rules.json": [
      { id: "r1", action: "writeIssue", field: "estimateHours", mode: "warn" },
    ],
  });
  const summary = loadConfigDir(dir);
  assert.equal(summary.rulesetsApplied, true);
  assert.ok(getFieldRules().some((r) => r.id === "r1" && r.field === "estimateHours"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a SEALED config.json is decrypted at boot (encrypted snapshots at rest)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omni-config-sealed-"));
  // Write the snapshot SEALED (as the bundle does) — opaque on disk.
  const sealed = sealConfig(JSON.stringify(buildSnapshot(getSettings())));
  assert.ok(sealed.startsWith("c1.")); // not plaintext on disk
  fs.writeFileSync(path.join(root, "config.json"), sealed);
  const summary = loadConfigDir(root);
  assert.equal(summary.configApplied, true); // decrypted + applied
  assert.equal(summary.errors.length, 0);
});

test("a config.json carrying a __proto__ payload cannot pollute Object.prototype", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omni-config-proto-"));
  const payload = '{"__proto__":{"polluted":true},"aiProvider":"none"}';
  fs.writeFileSync(path.join(root, "config.json"), sealConfig(payload));
  loadConfigDir(root);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
});

test("a config.json sealed under a DIFFERENT key surfaces a clear decrypt error", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omni-config-badkey-"));
  // c1. token whose body is garbage ⇒ can't decrypt with this deployment's key.
  fs.writeFileSync(path.join(root, "config.json"), "c1.1.bm90LWEtcmVhbC1ib2R5");
  const summary = loadConfigDir(root);
  assert.equal(summary.configApplied, false);
  assert.match(summary.errors.join(" "), /could not decrypt/);
});

test("the config bundle is a non-empty zip carrying config.json + rulesets (read ≡ dump)", () => {
  const zip = buildConfigBundle();
  assert.ok(Buffer.isBuffer(zip) && zip.length > 0);
  assert.equal(zip.subarray(0, 2).toString("latin1"), "PK"); // ZIP magic
  const text = zip.toString("latin1");
  assert.match(text, /config\.json/);
  assert.match(text, /rulesets\/field-rules\.json/);
  assert.match(text, /rulesets\/rule-modes\.json/);
});
