import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeWorkVocabularyOverride } from "./work-vocabulary-config";

/**
 * Scope-overridable work vocabulary: the PUT sanitiser (pure) enforces the relabel/reorder-only boundary,
 * and the resolver folds an org override over the shipped default while keeping the canonical set fixed.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "work-vocab-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("sanitizer keeps only canonical ids + label/order overrides, dropping empties", () => {
  const out = sanitizeWorkVocabularyOverride({
    statuses: [
      { id: "in_progress", label: "WIP", order: 2 },
      { id: "backlog", label: "  " }, // blank label ⇒ dropped entirely (no override fields)
    ],
    priorities: [{ id: "urgent", label: "P0" }],
  });
  assert.deepEqual(out.statuses, [{ id: "in_progress", label: "WIP", order: 2 }]);
  assert.deepEqual(out.priorities, [{ id: "urgent", label: "P0" }]);
});

test("sanitizer rejects a non-canonical id", () => {
  assert.throws(() => sanitizeWorkVocabularyOverride({ statuses: [{ id: "frozen", label: "Frozen" }] }), /not a canonical/);
});

test("sanitizer rejects a too-long label and a non-integer order", () => {
  assert.throws(() => sanitizeWorkVocabularyOverride({ statuses: [{ id: "done", label: "x".repeat(41) }] }), /too long/);
  assert.throws(() => sanitizeWorkVocabularyOverride({ priorities: [{ id: "low", order: 1.5 }] }), /non-negative integer/);
});

test("resolver folds an org override (relabel + reorder) and keeps the canonical set + lifecycle", async () => {
  const { resolveWorkVocabulary, WORK_VOCABULARY_CONFIG_ID, ORG_WORK_VOCABULARY_ID } = await import("./work-vocabulary-config");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  // Baseline: the shipped canonical vocabulary.
  const base = resolveWorkVocabulary();
  assert.deepEqual(base.statuses.map((s) => s.id), ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]);
  assert.equal(base.statuses.find((s) => s.id === "in_progress")!.label, "In progress");

  // Org relabels in_progress → "WIP" and floats it to order 0; a hand-injected bogus status must be ignored.
  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_WORK_VOCABULARY_ID, kind: "config", name: "Work vocabulary",
    payload: { id: WORK_VOCABULARY_CONFIG_ID, values: { statuses: [{ id: "in_progress", label: "WIP", order: 0 }, { id: "frozen", label: "Frozen", order: 0 }] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveWorkVocabulary();
  const wip = resolved.statuses.find((s) => s.id === "in_progress")!;
  assert.equal(wip.label, "WIP");
  assert.equal(wip.order, 0);
  assert.equal(wip.lifecycle, "active"); // lifecycle stays canonical
  // Re-sorted by the overridden order: the list is monotonic in `order`, and in_progress (now 0) floated
  // up from its shipped index (2).
  const orders = resolved.statuses.map((s) => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.ok(resolved.statuses.findIndex((s) => s.id === "in_progress") < 2);
  // The bogus "frozen" status was dropped — the set stays canonical.
  assert.ok(!resolved.statuses.some((s) => s.id === "frozen"));
  assert.equal(resolved.statuses.length, 6);
  // An untouched status keeps its shipped label.
  assert.equal(resolved.statuses.find((s) => s.id === "done")!.label, "Done");
});
