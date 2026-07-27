import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTaskContextVocabularyOverride } from "./task-context-vocabulary-config";

/**
 * Scope-overridable GTD task-context vocabulary. Contexts are org-owned (relabel/reorder/recolour/ADD/REMOVE,
 * methodology-tagged). Unlike energy there is NO ordinal level — a context needs only id + label + order. The
 * sanitiser (pure) enforces those boundaries.
 */

test("sanitizer: relabel an existing context, add a new one, remove a shipped one", () => {
  const out = sanitizeTaskContextVocabularyOverride({
    contexts: [
      { id: "calls", label: "Phone", order: 1 }, // relabel existing
      { id: "garage", label: "Garage", order: 6, methodologies: ["gtd"] }, // add
      { id: "office", removed: true }, // remove shipped
      { id: "home" }, // no override fields ⇒ dropped
    ],
  });
  assert.deepEqual(out.contexts, [
    { id: "calls", label: "Phone", order: 1 },
    { id: "garage", label: "Garage", order: 6, methodologies: ["gtd"] },
    { id: "office", removed: true },
  ]);
});

test("sanitizer: a new context needs a label AND an order (no level required)", () => {
  assert.throws(() => sanitizeTaskContextVocabularyOverride({ contexts: [{ id: "garage", label: "Garage" }] }), /needs a label and an order/);
  // With both, it is accepted (no ordinal level demanded — contexts are flat).
  const out = sanitizeTaskContextVocabularyOverride({ contexts: [{ id: "garage", label: "Garage", order: 9 }] });
  assert.deepEqual(out.contexts, [{ id: "garage", label: "Garage", order: 9 }]);
});

test("sanitizer: rejects a bad id, non-hex colour, and removing an unknown context", () => {
  assert.throws(() => sanitizeTaskContextVocabularyOverride({ contexts: [{ id: "Bad Id", label: "x", order: 0 }] }), /lower-case slug/);
  assert.throws(() => sanitizeTaskContextVocabularyOverride({ contexts: [{ id: "calls", color: "red" }] }), /6-digit hex/);
  assert.throws(() => sanitizeTaskContextVocabularyOverride({ contexts: [{ id: "ghost", removed: true }] }), /cannot remove unknown context/);
});

test("sanitizer: a non-object body throws", () => {
  assert.throws(() => sanitizeTaskContextVocabularyOverride([]), /must be an object/);
});
