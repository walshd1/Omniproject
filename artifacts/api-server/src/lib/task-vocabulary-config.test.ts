import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeTaskVocabularyOverride } from "./task-vocabulary-config";

/**
 * Scope-overridable GTD task-status vocabulary. Statuses are org-owned (relabel/reorder/ADD/REMOVE,
 * methodology-tagged, workflow-class-required), keeping the FIVE GTD classes. The sanitiser (pure) enforces
 * those boundaries; the resolver folds an org override over the shipped default.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "task-vocab-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("sanitizer: relabel an existing status, add a new one, remove a shipped one", () => {
  const out = sanitizeTaskVocabularyOverride({
    statuses: [
      { id: "waiting", label: "Blocked", order: 1 }, // relabel + reorder existing
      { id: "delegated", label: "Delegated", class: "waiting", order: 6, methodologies: ["gtd"] }, // add
      { id: "someday", removed: true }, // remove shipped
      { id: "next" }, // no override fields ⇒ dropped
    ],
  });
  assert.deepEqual(out.statuses, [
    { id: "waiting", label: "Blocked", order: 1 },
    { id: "delegated", label: "Delegated", class: "waiting", order: 6, methodologies: ["gtd"] },
    { id: "someday", removed: true },
  ]);
});

test("sanitizer: a NEW status must carry label + workflow class + order", () => {
  assert.throws(() => sanitizeTaskVocabularyOverride({ statuses: [{ id: "parked", label: "Parked" }] }), /needs a label, a workflow class and an order/);
  assert.throws(() => sanitizeTaskVocabularyOverride({ statuses: [{ id: "parked", label: "Parked", class: "frozen", order: 9 }] }), /class must be one of/);
});

test("sanitizer: the 5 GTD classes are accepted; the issue classes (open/active/cancelled) are NOT", () => {
  for (const cls of ["actionable", "waiting", "deferred", "done", "dropped"]) {
    const out = sanitizeTaskVocabularyOverride({ statuses: [{ id: "x", label: "X", class: cls, order: 9 }] });
    assert.equal(out.statuses[0]!.class, cls);
  }
  assert.throws(() => sanitizeTaskVocabularyOverride({ statuses: [{ id: "x", label: "X", class: "open", order: 9 }] }), /class must be one of/);
  assert.throws(() => sanitizeTaskVocabularyOverride({ statuses: [{ id: "x", label: "X", class: "cancelled", order: 9 }] }), /class must be one of/);
});

test("sanitizer: removing an unknown status is rejected; a colour must be a 6-digit hex", () => {
  assert.throws(() => sanitizeTaskVocabularyOverride({ statuses: [{ id: "nope", removed: true }] }), /cannot remove unknown status/);
  assert.deepEqual(sanitizeTaskVocabularyOverride({ statuses: [{ id: "done", color: "#123abc" }] }).statuses, [{ id: "done", color: "#123abc" }]);
  assert.throws(() => sanitizeTaskVocabularyOverride({ statuses: [{ id: "done", color: "red" }] }), /must be a 6-digit hex/);
});

test("sanitizer: per-locale translations validate locale keys", () => {
  const out = sanitizeTaskVocabularyOverride({ statuses: [{ id: "done", labels: { de: "Erledigt", "en-GB": "Done" } }] });
  assert.deepEqual(out.statuses, [{ id: "done", labels: { de: "Erledigt", "en-GB": "Done" } }]);
  assert.throws(() => sanitizeTaskVocabularyOverride({ statuses: [{ id: "done", labels: { German: "Erledigt" } }] }), /not a valid locale/);
});

test("resolver: shipped default is the 6 GTD statuses in order", async () => {
  const { resolveTaskVocabulary } = await import("./task-vocabulary-config");
  const base = resolveTaskVocabulary();
  assert.deepEqual(base.statuses.map((s) => s.id), ["next", "waiting", "scheduled", "someday", "done", "dropped"]);
  assert.equal(base.statuses.find((s) => s.id === "next")!.class, "actionable");
  assert.equal(base.statuses.find((s) => s.id === "done")!.color, "#22c55e"); // shipped hex colour
});

test("resolver: an org can add, remove and relabel statuses; methodology tags filter", async () => {
  const { resolveTaskVocabulary, TASK_VOCABULARY_CONFIG_ID, ORG_TASK_VOCABULARY_ID } = await import("./task-vocabulary-config");
  const { taskStatusesForMethodology } = await import("@workspace/backend-catalogue");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_TASK_VOCABULARY_ID, kind: "config", name: "Task vocabulary",
    payload: { id: TASK_VOCABULARY_CONFIG_ID, values: { statuses: [
      { id: "waiting", label: "Blocked" }, // relabel
      { id: "delegated", label: "Delegated", class: "waiting", order: 25, methodologies: ["gtd"] }, // add (gtd-only)
      { id: "someday", removed: true }, // remove
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveTaskVocabulary();
  const ids = resolved.statuses.map((s) => s.id);
  assert.ok(!ids.includes("someday"), "removed status is gone");
  assert.ok(ids.includes("delegated"), "added status is present");
  assert.equal(resolved.statuses.find((s) => s.id === "waiting")!.label, "Blocked");
  assert.equal(resolved.statuses.find((s) => s.id === "waiting")!.class, "waiting"); // class preserved through relabel
  const delegated = resolved.statuses.find((s) => s.id === "delegated")!;
  assert.equal(delegated.class, "waiting");
  assert.deepEqual(delegated.methodologies, ["gtd"]);

  // Methodology filter: the gtd-tagged "delegated" applies to gtd, not to scrum; neutral statuses apply to both.
  assert.ok(taskStatusesForMethodology("gtd", resolved.statuses).some((s) => s.id === "delegated"));
  assert.ok(!taskStatusesForMethodology("scrum", resolved.statuses).some((s) => s.id === "delegated"));
  assert.ok(taskStatusesForMethodology("scrum", resolved.statuses).some((s) => s.id === "next")); // neutral applies everywhere
});
