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
  for (const k of ["report", "form", "businessRule", "methodology", "dashboard", "screen", "primitive"] as const) {
    assert.ok(kinds.has(k), `the system store has a ${k} default`);
  }
  // The shipped screens + primitives are seeded (relocated into the shared catalogue — X.11).
  assert.ok(defs.some((d) => d.kind === "screen" && (d.payload as { id?: unknown }).id === "home"), "the Home screen is a shipped system default");
  assert.ok(defs.some((d) => d.kind === "primitive" && (d.payload as { id?: unknown }).id === "bar"), "the bar-chart primitive is a shipped system default");
  // The `blank` bootstrap base is seeded into the SYSTEM base layer, so it shows through at the root of EVERY
  // org's tree by default (inherited, inert) — an org "updates" it via a copy-and-override to start a family.
  assert.ok(defs.some((d) => d.kind === "primitive" && (d.payload as { id?: unknown }).id === "blank" && d.createdBy === "system"), "the blank bootstrap base is inherited by every org");
  // The methodology overview screens are ordinary catalogue screens (built purely from atom panels) — they seed
  // through the same `screen` path as every other screen, alongside their ancestor primitive defs.
  assert.ok(defs.some((d) => d.kind === "screen" && (d.payload as { id?: unknown }).id === "scrum-overview"), "the Scrum overview screen is a shipped system default");
  assert.ok(defs.some((d) => d.kind === "screen" && (d.payload as { id?: unknown }).id === "kanban-overview"), "the Kanban overview screen is a shipped system default");
  // Every shipped default is a read-only system row authored by "system".
  assert.ok(defs.every((d) => d.id.startsWith("system~") && d.createdBy === "system"));
  // The canonical work-item vocabulary is seeded as a read-only system `config` def (statuses + priorities),
  // so the canonical set is derived from the system JSON store like every other shipped default.
  const vocab = defs.find((d) => d.kind === "config" && (d.payload as { id?: unknown }).id === "work-vocabulary");
  assert.ok(vocab, "the work-vocabulary config is a shipped system default");
  const values = (vocab!.payload as { values: { statuses: Array<{ id: string }>; priorities: Array<{ id: string }> } }).values;
  assert.deepEqual(values.statuses.map((s) => s.id), ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]);
  assert.deepEqual(values.priorities.map((p) => p.id), ["urgent", "high", "medium", "low", "none"]);
  // The definition-write POLICY LEVELS are seeded as a system `config` def (levels are data; enforcement is code),
  // scope-overridable via copy-and-override like any other config.
  const policy = defs.find((d) => d.kind === "config" && (d.payload as { id?: unknown }).id === "def-scope-policy");
  assert.ok(policy, "the def-scope-policy config is a shipped system default");
  assert.deepEqual((policy!.payload as { values: unknown }).values, { user: "contributor", project: "manager", programme: "programmeManager", org: "pmoOrAdmin" });
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
