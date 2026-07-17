import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The shipped-defaults installer (roadmap X.11): our bundled catalogues (reports/forms/business-rule reference
 * bundles/dashboard presets) are sealed into the read-only `system` def store in ONE write, auto-installed on
 * first boot only. Updates are the admin-gated route's job, not automatic.
 */
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "system-defs-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("seedSystemDefaultsIfEmpty installs the bundled defaults once; applySystemDefaults re-applies in one shot", async () => {
  const { seedSystemDefaultsIfEmpty, applySystemDefaults } = await import("../lib/system-defs");
  const { listSystemDefs } = await import("../lib/def-import");

  const first = seedSystemDefaultsIfEmpty();
  assert.equal(first.seeded, true);
  assert.ok(first.count > 0);

  const defs = listSystemDefs();
  const kinds = new Set(defs.map((d) => d.kind));
  for (const k of ["report", "form", "businessRule", "methodology", "dashboard"] as const) {
    assert.ok(kinds.has(k), `the system store has a ${k} default`);
  }
  // Every shipped default is a read-only system row authored by "system".
  assert.ok(defs.every((d) => d.id.startsWith("system~") && d.createdBy === "system"));
  // The dashboard presets were adapted to the real Dashboard shape (each widget gets a synthesised id).
  const dash = defs.find((d) => d.kind === "dashboard")!;
  const widgets = (dash.payload as { widgets: Array<{ id: string; type: string }> }).widgets;
  assert.ok(widgets.every((w) => typeof w.id === "string" && typeof w.type === "string"));

  // Idempotent install: a second call is a no-op (updates go through the admin-gated route).
  assert.equal(seedSystemDefaultsIfEmpty().seeded, false);

  // The one-shot re-apply replaces the whole set to the same deterministic content (no growth).
  const reapplied = applySystemDefaults();
  assert.equal(reapplied.count, first.count);
  assert.equal(listSystemDefs().length, first.count);
});
