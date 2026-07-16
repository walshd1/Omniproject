import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";

let mod: typeof import("./extension");
import type { ActorContext } from "../broker/types";
const ctx: ActorContext = { sub: "u1", name: "Ada", email: "ada@x.io" } as ActorContext;

before(async () => { mod = await import("./extension"); });
beforeEach(() => { process.env["OMNI_CONFIG_DIR"] = fs.mkdtempSync(path.join(os.tmpdir(), "ext-")); });
after(() => { delete process.env["OMNI_CONFIG_DIR"]; });

const manifest = {
  name: "Acme Reports Pack", publisher: "Acme", version: "2.1.0", description: "Extra reports",
  contributions: [
    { kind: "report", name: "Burn rate", def: { id: "burn-rate", engine: "custom" } },
    { kind: "contentPage", name: "Playbook", def: { blocks: [] } },
  ],
};

test("sanitizeExtensionInstall validates the manifest + contributions", () => {
  const w = mod.sanitizeExtensionInstall(manifest);
  assert.equal(w.name, "Acme Reports Pack");
  assert.equal(w.version, "2.1.0");
  assert.equal(w.contributions.length, 2);
  assert.equal(w.contributions[0]!.id, "c-1"); // id stamped
  assert.throws(() => mod.sanitizeExtensionInstall({ publisher: "x", contributions: [] }), (e) => e instanceof mod.ExtensionError && /name/.test((e as Error).message));
  assert.throws(() => mod.sanitizeExtensionInstall({ name: "x", publisher: "y", contributions: [] }), (e) => e instanceof mod.ExtensionError && /at least one/.test((e as Error).message));
  assert.throws(() => mod.sanitizeExtensionInstall({ name: "x", publisher: "y", contributions: [{ kind: "bogus", name: "z", def: {} }] }), (e) => e instanceof mod.ExtensionError && /kind/.test((e as Error).message));
  assert.throws(() => mod.sanitizeExtensionInstall({ name: "x", publisher: "y", contributions: [{ kind: "report", name: "z" }] }), (e) => e instanceof mod.ExtensionError && /def/.test((e as Error).message));
});

test("install → list → status → active contributions → delete round-trips (org store)", () => {
  const row = mod.newExtensionRow("e1", mod.sanitizeExtensionInstall(manifest), ctx, "2026-01-01T00:00:00Z");
  assert.equal(row.status, "installed");
  assert.equal(row.installedBy, "ada@x.io");
  mod.putExtension(row);

  assert.equal(mod.listExtensions().length, 1);
  assert.equal(mod.extensionMeta(row).contributionCount, 2);
  assert.deepEqual(mod.extensionMeta(row).contributionKinds.sort(), ["contentPage", "report"]);

  // Active contributions surface an installed extension's parts by kind.
  assert.equal(mod.activeContributions("report").length, 1);
  assert.equal(mod.activeContributions("report")[0]!.extensionName, "Acme Reports Pack");

  // Disabling hides its contributions from the read hook but keeps the row.
  mod.putExtension(mod.setExtensionStatus(row, "disabled", "2026-02-01T00:00:00Z"));
  assert.equal(mod.getExtension("e1")!.status, "disabled");
  assert.equal(mod.activeContributions("report").length, 0);

  assert.equal(mod.deleteExtension("e1"), true);
  assert.equal(mod.listExtensions().length, 0);
});
