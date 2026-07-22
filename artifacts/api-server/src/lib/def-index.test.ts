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
