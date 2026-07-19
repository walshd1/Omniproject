import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeWorkVocabularyOverride } from "./work-vocabulary-config";

/**
 * Scope-overridable work vocabulary. Statuses are org-owned (relabel/reorder/ADD/REMOVE, methodology-tagged,
 * lifecycle-required); priorities are a fixed relabel/reorder scale. The sanitiser (pure) enforces those
 * boundaries; the resolver folds an org override over the shipped default.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "work-vocab-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("sanitizer: relabel an existing status, add a new one, remove a shipped one", () => {
  const out = sanitizeWorkVocabularyOverride({
    statuses: [
      { id: "in_progress", label: "WIP", order: 2 }, // relabel + reorder existing
      { id: "blocked", label: "Blocked", lifecycle: "active", order: 3, methodologies: ["kanban"] }, // add
      { id: "cancelled", removed: true }, // remove shipped
      { id: "todo" }, // no override fields ⇒ dropped
    ],
  });
  assert.deepEqual(out.statuses, [
    { id: "in_progress", label: "WIP", order: 2 },
    { id: "blocked", label: "Blocked", lifecycle: "active", order: 3, methodologies: ["kanban"] },
    { id: "cancelled", removed: true },
  ]);
});

test("sanitizer: a NEW status must carry label + lifecycle + order", () => {
  assert.throws(() => sanitizeWorkVocabularyOverride({ statuses: [{ id: "frozen", label: "Frozen" }] }), /needs a label, a lifecycle class and an order/);
  assert.throws(() => sanitizeWorkVocabularyOverride({ statuses: [{ id: "frozen", label: "Frozen", lifecycle: "slushy", order: 9 }] }), /lifecycle must be one of/);
});

test("sanitizer: priorities are relabel/reorder only — no add/remove", () => {
  const out = sanitizeWorkVocabularyOverride({ priorities: [{ id: "urgent", label: "P0" }] });
  assert.deepEqual(out.priorities, [{ id: "urgent", label: "P0" }]);
  assert.throws(() => sanitizeWorkVocabularyOverride({ priorities: [{ id: "p0", label: "P0" }] }), /not a canonical priority/);
});

test("resolver: an org can add, remove and relabel statuses; methodology tags filter", async () => {
  const { resolveWorkVocabulary, WORK_VOCABULARY_CONFIG_ID, ORG_WORK_VOCABULARY_ID } = await import("./work-vocabulary-config");
  const { statusesForMethodology } = await import("@workspace/backend-catalogue");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  const base = resolveWorkVocabulary();
  assert.deepEqual(base.statuses.map((s) => s.id), ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]);

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_WORK_VOCABULARY_ID, kind: "config", name: "Work vocabulary",
    payload: { id: WORK_VOCABULARY_CONFIG_ID, values: { statuses: [
      { id: "in_progress", label: "WIP" }, // relabel
      { id: "blocked", label: "Blocked", lifecycle: "active", order: 25, methodologies: ["kanban"] }, // add (kanban-only)
      { id: "cancelled", removed: true }, // remove
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveWorkVocabulary();
  const ids = resolved.statuses.map((s) => s.id);
  assert.ok(!ids.includes("cancelled"), "removed status is gone");
  assert.ok(ids.includes("blocked"), "added status is present");
  assert.equal(resolved.statuses.find((s) => s.id === "in_progress")!.label, "WIP");
  assert.equal(resolved.statuses.find((s) => s.id === "in_progress")!.lifecycle, "active"); // lifecycle preserved
  const blocked = resolved.statuses.find((s) => s.id === "blocked")!;
  assert.equal(blocked.lifecycle, "active");
  assert.deepEqual(blocked.methodologies, ["kanban"]);

  // Methodology filter: the kanban-tagged "blocked" applies to kanban, not to scrum; neutral statuses apply to both.
  assert.ok(statusesForMethodology("kanban", resolved.statuses).some((s) => s.id === "blocked"));
  assert.ok(!statusesForMethodology("scrum", resolved.statuses).some((s) => s.id === "blocked"));
  assert.ok(statusesForMethodology("scrum", resolved.statuses).some((s) => s.id === "in_progress")); // neutral applies everywhere
});
