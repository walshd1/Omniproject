import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfigDir } from "../lib/config-dir";
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
