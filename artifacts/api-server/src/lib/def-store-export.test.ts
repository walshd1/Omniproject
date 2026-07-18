import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Enable the encrypted artifact store on a temp config dir BEFORE importing anything that reads it.
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "def-store-export-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const { putDef, listDefs, seedSystemDef, listSystemDefs } = await import("./def-import");
const { setScopeBinding, getScopeBindings } = await import("./def-binding");
const { putArtifact, listArtifacts } = await import("./artifact-store");
const { setUserPrefs, getUserPrefs } = await import("./user-prefs");
const { putExtension } = await import("./extension");
const { putRegistryItem } = await import("./registry");
const { buildDefStoreExport, applyDefStoreExport, DEF_STORE_EXPORT_SCHEMA } = await import("./def-store-export");

const now = "2026-07-17T00:00:00.000Z";
const PRIMITIVE = { id: "grouped-column", label: "Grouped columns", category: "chart", chartType: "bar",
  description: "compare series", params: [{ key: "data", label: "Rows", type: "rows", required: true, description: "rows" }] };
const orgDef = { id: "org~d1", kind: "primitive" as const, name: "Chart", createdBy: "a", createdAt: now, updatedAt: now, rowVersion: 1,
  payload: PRIMITIVE };
const userDef = { id: "user~d2", kind: "theme" as const, name: "Dark", createdBy: "u", createdAt: now, updatedAt: now, rowVersion: 1,
  payload: { id: "dark", colors: { primary: "#000" } } };

before(() => {
  putDef({ kind: "org" }, orgDef);
  putDef({ kind: "user", sub: "u1" }, userDef);
  setScopeBinding({ kind: "org" }, "screens", { defId: "org~d1", locked: true });
  putArtifact("def-policy", { kind: "org" }, { id: "policy", user: "contributor", project: "manager", programme: "programmeManager", org: "admin" });
  // A SYSTEM def — must NOT appear in a customer export.
  seedSystemDef("report", "System report", { id: "sr", title: "System report", sections: [] }, now);
});
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("buildDefStoreExport captures the customer-authored stores and EXCLUDES the system scope", () => {
  const bundle = buildDefStoreExport(now);
  assert.equal(bundle.schema, DEF_STORE_EXPORT_SCHEMA);
  // The org + user defs are present.
  const defCols = bundle.collections.filter((c) => c.type === "def");
  const ids = defCols.flatMap((c) => c.items.map((i) => i.id));
  assert.ok(ids.includes("org~d1") && ids.includes("user~d2"));
  // No system-scope collection rode along, even though a system def exists.
  assert.ok(listSystemDefs().length > 0, "a system def was seeded");
  assert.ok(!bundle.collections.some((c) => c.scope.kind === "system"), "system scope must be excluded");
  // The binding + policy collections are present too.
  assert.ok(bundle.collections.some((c) => c.type === "def-binding"));
  assert.ok(bundle.collections.some((c) => c.type === "def-policy"));
});

test("applyDefStoreExport re-writes the bundle into a FRESH store (round-trip = full migration)", () => {
  const bundle = buildDefStoreExport(now);
  // Simulate a new instance: wipe the artifacts dir, then reimport.
  fs.rmSync(path.join(CONFIG_DIR, "artifacts"), { recursive: true, force: true });
  assert.equal(listDefs({ kind: "org" }).length, 0, "store is empty after wipe");
  const report = applyDefStoreExport(bundle);
  // Everything came back.
  assert.equal(listDefs({ kind: "org" })[0]?.id, "org~d1");
  assert.equal(listDefs({ kind: "user", sub: "u1" })[0]?.id, "user~d2");
  assert.equal(getScopeBindings({ kind: "org" })["screens"]?.defId, "org~d1");
  assert.equal(getScopeBindings({ kind: "org" })["screens"]?.locked, true);
  assert.ok(report.written.some((w) => w.type === "def" && w.scope.kind === "org"));
});

test("import REFUSES the read-only system scope (it re-seeds from code)", () => {
  const tainted = {
    schema: DEF_STORE_EXPORT_SCHEMA, version: 1, createdAt: now,
    collections: [{ type: "def", scope: { kind: "system" }, items: [{ id: "system~evil", kind: "primitive", name: "x", payload: { id: "x", label: "x", category: "chart", params: [] } }] }],
  };
  const report = applyDefStoreExport(tainted);
  assert.ok(report.warnings.some((w) => /system scope/i.test(w)));
  assert.ok(report.skipped >= 1);
});

test("import RE-VALIDATES defs: a tampered/invalid payload is dropped, not written", () => {
  const bundle = {
    schema: DEF_STORE_EXPORT_SCHEMA, version: 1, createdAt: now,
    collections: [{ type: "def", scope: { kind: "org" }, items: [
      { id: "org~good", kind: "primitive", name: "Good", payload: PRIMITIVE },
      { id: "org~bad", kind: "primitive", name: "Bad", payload: { not: "a valid primitive" } },
    ] }],
  };
  const report = applyDefStoreExport(bundle);
  const ids = listArtifacts<{ id: string }>("def", { kind: "org" }).map((d) => d.id);
  assert.ok(ids.includes("org~good"));
  assert.ok(!ids.includes("org~bad"), "the invalid def must be dropped");
  assert.ok(report.skipped >= 1);
});

test("import rejects an unrecognised schema", () => {
  assert.throws(() => applyDefStoreExport({ schema: "not-ours", collections: [] }), /schema/i);
});

test("org extensions + registry items ride the backup; import RE-VALIDATES (a tampered row is dropped)", () => {
  putExtension({ id: "ext1", name: "Charts", publisher: "acme", version: "1.0.0", description: null, status: "installed",
    contributions: [{ id: "c1", kind: "report", name: "Rep", def: { id: "r", title: "R", sections: [] } }],
    installedAt: now, installedBy: "a", updatedAt: now, rowVersion: 1 });
  putRegistryItem({ id: "reg1", kind: "report", name: "Shared report", publisher: "acme", version: "1.0.0", description: null,
    tags: [], payload: { id: "r2", title: "R2", sections: [] }, approvalStatus: "approved", visibility: "internal",
    submittedBy: "a", submittedAt: now, reviewedBy: "a", reviewedAt: now, reviewNote: null, releasedAt: null,
    communityRef: null, updatedAt: now, rowVersion: 1 });

  const bundle = buildDefStoreExport(now);
  assert.ok(bundle.collections.some((c) => c.type === "extension"), "extensions ride the backup");
  assert.ok(bundle.collections.some((c) => c.type === "registry-item"), "registry items ride the backup");

  // Tamper: inject an extension whose contribution has no valid def — import must drop it.
  const extCol = bundle.collections.find((c) => c.type === "extension")!;
  extCol.items.push({ id: "evil", name: "Bad", contributions: [{ kind: "report", name: "x" /* no def */ }] } as never);

  fs.rmSync(path.join(CONFIG_DIR, "artifacts"), { recursive: true, force: true });
  const report = applyDefStoreExport(bundle);
  const exts = listArtifacts<{ id: string }>("extension", { kind: "org" }).map((e) => e.id);
  assert.ok(exts.includes("ext1"), "the valid extension came back");
  assert.ok(!exts.includes("evil"), "the tampered extension was dropped on import");
  assert.equal(listArtifacts<{ id: string }>("registry-item", { kind: "org" })[0]?.id, "reg1");
  assert.ok(report.written.some((w) => w.type === "extension") && report.written.some((w) => w.type === "registry-item"));
});

test("config defs (the org-level tree) ride the backup and round-trip into a fresh store", () => {
  // A scope-layered config def — the migration vehicle — at org + project scope.
  putDef({ kind: "org" }, { id: "org~config-scheduling", kind: "config", name: "Working time", createdBy: "a", createdAt: now, updatedAt: now, rowVersion: 1, payload: { id: "scheduling", values: { hoursPerDay: 7 } } });
  putDef({ kind: "project", projectId: "PB" }, { id: "project~PB~cfg", kind: "config", name: "Proj sched", createdBy: "a", createdAt: now, updatedAt: now, rowVersion: 1, payload: { id: "scheduling", values: { hoursPerDay: 6 } } });

  const bundle = buildDefStoreExport(now);
  const ids = bundle.collections.filter((c) => c.type === "def").flatMap((c) => c.items.map((i) => i.id));
  assert.ok(ids.includes("org~config-scheduling"), "the org config def is captured");
  assert.ok(ids.includes("project~PB~cfg"), "the project config def is captured");

  // Wipe + reimport — the full config tree comes back, re-validated by kind.
  fs.rmSync(path.join(CONFIG_DIR, "artifacts"), { recursive: true, force: true });
  applyDefStoreExport(bundle);
  assert.equal(listDefs({ kind: "org" }).find((d) => d.id === "org~config-scheduling")?.kind, "config");
  assert.equal(listDefs({ kind: "project", projectId: "PB" })[0]?.id, "project~PB~cfg");
});

test("per-user prefs ride the backup and round-trip into a fresh store (setup follows the person)", () => {
  // With the store enabled, a save lands in the user's OWN vault, not the settings blob.
  setUserPrefs("u-prefs", { fontScale: 1.25, highContrast: true, backgroundColor: "#0b1020" });
  const bundle = buildDefStoreExport(now);
  const prefsCol = bundle.collections.find((c) => c.type === "user-prefs" && c.scope.kind === "user");
  assert.ok(prefsCol, "a user-prefs collection is captured in the backup");
  assert.equal(prefsCol.items[0]?.id, "prefs");

  // Migrate: wipe the store, reimport the bundle — the person's setup comes back intact.
  fs.rmSync(path.join(CONFIG_DIR, "artifacts"), { recursive: true, force: true });
  const report = applyDefStoreExport(bundle);
  assert.ok(report.written.some((w) => w.type === "user-prefs"));
  const restored = getUserPrefs("u-prefs");
  assert.equal(restored.fontScale, 1.25);
  assert.equal(restored.highContrast, true);
  assert.equal(restored.backgroundColor, "#0b1020");
});
