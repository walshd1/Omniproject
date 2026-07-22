import { test } from "node:test";
import assert from "node:assert/strict";
import { composeExtends, extendsLineage, mergeValue } from "./def-compose";
import { reportCatalogue, resolveReport } from "./report-catalogue";
import { screenDefCatalogue, resolveScreenDef } from "./screen-def-catalogue";

/**
 * The generic `extends` model (def-compose) rolled out to reports + screens: a def is a ROOT or a THIN child
 * that extends a parent and adds/alters properties property-by-property. `composeExtends` folds the chain;
 * `mergeValue` is the algebra (objects deep-merge, arrays-of-{id} merge by id, scalars child-win).
 */

const REG = {
  base: { id: "base", label: "Base", n: 1, caps: { a: true, b: false }, tools: ["x"], panels: [{ id: "p1", kind: "table" }] },
  child: { id: "child", extends: "base", label: "Child", caps: { b: true }, panels: [{ id: "p1", kind: "register" }, { id: "p2", kind: "chart" }] },
} as Record<string, { id: string; extends?: string } & Record<string, unknown>>;
const byId = (k: string) => REG[k];

test("mergeValue: scalars child-win, objects deep-merge, arrays-of-{id} merge by id", () => {
  assert.equal(mergeValue(1, 2), 2);
  assert.equal(mergeValue("a", undefined), "a");                                  // undefined inherits
  assert.deepEqual(mergeValue({ a: 1, b: 1 }, { b: 2, c: 3 }), { a: 1, b: 2, c: 3 }); // deep object merge
  assert.deepEqual(mergeValue(["x"], ["y"]), ["y"]);                              // id-less array replaced
  assert.deepEqual(
    mergeValue([{ id: "p1", k: "a" }], [{ id: "p1", k: "b" }, { id: "p2" }]),
    [{ id: "p1", k: "b" }, { id: "p2" }],                                          // merge by id, override + append
  );
});

test("composeExtends: leaf wins property-by-property; lineage recorded leaf→root", () => {
  const r = composeExtends("child", byId)!;
  assert.deepEqual(r.lineage, ["child", "base"]);
  assert.equal(r["label"], "Child");                                              // scalar overridden
  assert.equal(r["n"], 1);                                                        // inherited from base
  assert.deepEqual(r["caps"], { a: true, b: true });                             // object deep-merged (child b wins)
  assert.deepEqual(r["tools"], ["x"]);                                            // inherited (child omits)
  assert.deepEqual(r["panels"], [{ id: "p1", kind: "register" }, { id: "p2", kind: "chart" }]); // panel p1 overridden, p2 added
});

test("a rootless def composes to itself; unknown id is undefined", () => {
  assert.deepEqual(composeExtends("base", byId)!.lineage, ["base"]);
  assert.equal(composeExtends("nope", byId), undefined);
});

test("a cycle and a missing parent both throw (fail-closed)", () => {
  const cyc: Record<string, { id: string; extends?: string }> = { a: { id: "a", extends: "b" }, b: { id: "b", extends: "a" } };
  assert.throws(() => extendsLineage("a", (k) => cyc[k]), /cycle/);
  assert.throws(() => extendsLineage("a", (k) => ({ a: { id: "a", extends: "ghost" } } as Record<string, { id: string; extends?: string }>)[k]), /does not exist/);
});

test("every shipped REPORT resolves its extends chain (all defs call one above them, or are roots)", () => {
  for (const r of reportCatalogue()) assert.doesNotThrow(() => resolveReport(r.id), `report "${r.id}" must resolve`);
});

test("every shipped SCREEN resolves its extends chain", () => {
  for (const s of screenDefCatalogue()) assert.doesNotThrow(() => resolveScreenDef(s.id), `screen "${s.id}" must resolve`);
});
