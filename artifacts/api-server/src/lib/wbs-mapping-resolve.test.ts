import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeWbsMapping, CORE_WBS_MAPPINGS, DEFAULT_WBS_SLOT } from "./wbs-mapping-resolve";
import { WbsMappingError, type WbsFieldMapping } from "./wbs-mapping";

/**
 * Scope-overridable WBS mapping (§4.6): the shipped core mapping, overridden per-field by org → programme →
 * project → user, NEAREST WINS — "core mappings in the system store, overridable in our established pattern."
 * The merge itself is pure; these prove the layering + validation without touching the sealed store.
 */

const core = CORE_WBS_MAPPINGS[DEFAULT_WBS_SLOT]!;

test("with no overrides, the resolved mapping is exactly the shipped core", () => {
  assert.deepEqual(mergeWbsMapping({ core }), core);
});

test("a higher scope overrides only the fields it names; the rest inherit downward", () => {
  // Org points cost figures at the sidecar; the project retargets just `budget` back to a tracker field.
  const org: Partial<WbsFieldMapping> = {
    actual: { target: "sidecar", field: "ourActual" },
    commitment: { target: "sidecar", field: "ourCommit" },
  };
  const project: Partial<WbsFieldMapping> = { budget: { target: "sidecar", field: "ourBudget" } };
  const m = mergeWbsMapping({ core, org, project });
  // Structure inherited straight from core…
  assert.equal(m.id, "id");
  assert.equal(m.name, "name");
  // …org's sidecar retargeting survived…
  assert.deepEqual(m.actual, { target: "sidecar", field: "ourActual" });
  // …and the project's single-field override won over both core and org.
  assert.deepEqual(m.budget, { target: "sidecar", field: "ourBudget" });
});

test("nearest wins: user beats project beats programme beats org beats core", () => {
  const m = mergeWbsMapping({
    core,
    org: { status: "orgStatus" },
    programme: { status: "progStatus" },
    project: { status: "projStatus" },
    user: { status: "userStatus" },
  });
  assert.equal(m.status, "userStatus");
});

test("the merged result is validated: an override may not smuggle an unsafe field name", () => {
  assert.throws(() => mergeWbsMapping({ core, project: { name: "__proto__" } }), WbsMappingError);
});

test("a partial base with no id/name still fails — the merge must yield a whole mapping", () => {
  assert.throws(() => mergeWbsMapping({ org: { budget: "b" } }), WbsMappingError);
});
