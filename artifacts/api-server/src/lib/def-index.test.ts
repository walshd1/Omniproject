import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDefIndex, defHasChildren } from "./def-index";
import type { StoredDef } from "./def-import";

/**
 * The composition child-edge index — the pure edge-building + query logic that gates the importer's fast path.
 * The load-bearing property: it records EVERY child edge from the stored defs (so it never under-reports), keyed
 * by kind + parent logical id.
 */

const def = (kind: string, id: string, ext?: string): StoredDef => ({
  id: `user~${id}`, kind: kind as StoredDef["kind"], name: id,
  payload: { id, ...(ext ? { extends: ext } : {}) },
  createdBy: null, createdAt: "", updatedAt: "", rowVersion: 1,
});

test("buildDefIndex records every extends edge, per kind + parent", () => {
  const ix = buildDefIndex([
    { items: [def("primitive", "base"), def("primitive", "child", "base"), def("primitive", "grand", "child")] },
    { items: [def("mapping", "risks", "base-register"), def("primitive", "loner")] },
  ]);
  assert.equal(defHasChildren(ix, "primitive", "base"), true);      // child extends base
  assert.equal(defHasChildren(ix, "primitive", "child"), true);     // grand extends child
  assert.equal(defHasChildren(ix, "primitive", "grand"), false);    // nothing extends grand
  assert.equal(defHasChildren(ix, "primitive", "loner"), false);    // rootless + childless → fast-path eligible
  assert.equal(defHasChildren(ix, "mapping", "base-register"), true);
  assert.equal(defHasChildren(ix, "primitive", "base-register"), false); // kinds don't cross
});

test("edges are deduped and a def with no extends adds none", () => {
  const ix = buildDefIndex([
    { items: [def("primitive", "child", "base"), def("primitive", "child", "base")] }, // same edge twice
    { items: [def("primitive", "root")] },                                             // rootless
  ]);
  assert.deepEqual(ix.children["primitive"]!["base"], ["child"]);   // deduped
  assert.equal(defHasChildren(ix, "primitive", "root"), false);
  assert.equal(ix.children["primitive"]!["root"], undefined);
});

test("a reserved-key `extends` ref never crashes index building and always forces the full scan", () => {
  // A def whose `extends` collides with an Object.prototype member is untrusted + pathological. Building the
  // index used to do `byParent["constructor"] ??= []` → read the inherited constructor → `.includes` threw a
  // TypeError (an uncaught crash on every full-path integrity check). It must build cleanly now, and the
  // reserved id must be treated as HAVING children so the caller falls to the authoritative full scan.
  for (const bad of ["constructor", "__proto__", "prototype", "toString", "valueOf"]) {
    const ix = buildDefIndex([{ items: [def("report", "kid", bad), def("report", bad)] }]); // must not throw
    assert.equal(defHasChildren(ix, "report", bad), true);           // over-report → safe full scan, never a crash
    assert.equal(hasProp(ix.children["report"], bad), false);        // the reserved edge is never stored as a key
  }
});

test("indexing a reserved-key edge does not pollute Object.prototype", () => {
  buildDefIndex([{ items: [def("report", "kid", "__proto__"), def("report", "evil", "constructor")] }]);
  assert.equal(({} as Record<string, unknown>)["kid"], undefined);  // no stray global property leaked in
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
});

function hasProp(o: Record<string, unknown> | undefined, k: string): boolean {
  return !!o && Object.prototype.hasOwnProperty.call(o, k);
}
