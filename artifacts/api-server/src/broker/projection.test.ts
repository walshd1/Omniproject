import { test } from "node:test";
import assert from "node:assert/strict";
import { applyValueMap, getPath, unwrap, applyTransform, evalPredicate, asRecord } from "./projection";

test("applyValueMap: lookup, lower-casing, fallback, and proto-safety", () => {
  const map = { open: "todo", done: "done" };
  assert.equal(applyValueMap("open", map), "todo");
  assert.equal(applyValueMap("OPEN", map, { lowerCase: true }), "todo"); // trims + lower-cases
  assert.equal(applyValueMap("  Done ", map, { lowerCase: true }), "done");
  assert.equal(applyValueMap("missing", map), undefined);
  assert.equal(applyValueMap("missing", map, { fallback: "todo" }), "todo");
  assert.equal(applyValueMap("x", undefined), undefined);
  // own-property only — a prototype key must not resolve to Object.prototype.toString
  assert.equal(applyValueMap("toString", map), undefined);
});

test("getPath walks objects + numeric array indices, undefined on a missing hop", () => {
  const src = { a: { b: [{ c: "hit" }] } };
  assert.equal(getPath(src, "a.b.0.c"), "hit");
  assert.equal(getPath(src, "a.b.9.c"), undefined);
  assert.equal(getPath(src, "a.x.c"), undefined);
  assert.equal(getPath(null, "a"), undefined);
});

test("unwrap descends into the first present wrapper, else returns the record", () => {
  assert.deepEqual(unwrap({ data: { id: 1 } }, ["data"]), { id: 1 });
  assert.deepEqual(unwrap({ id: 1 }, ["data"]), { id: 1 });
  assert.equal(unwrap("nope", ["data"]), null);
});

test("applyTransform: identity, date-only, map, sign-when, const-when-gt", () => {
  assert.equal(applyTransform({ x: "v" }, { to: "y", from: "x" }), "v");
  assert.equal(applyTransform({ d: "2026-08-01T00:00:00Z" }, { to: "o", from: "d", transform: "date-only" }), "2026-08-01");
  assert.equal(applyTransform({ d: null }, { to: "o", from: "d", transform: "date-only" }), null);
  assert.equal(applyTransform({ k: "labour" }, { to: "t", from: "k", transform: "map", map: { labour: "2" }, default: "1" }), "2");
  assert.equal(applyTransform({ k: "other" }, { to: "t", from: "k", transform: "map", map: { labour: "2" }, default: "1" }), "1");
  assert.equal(applyTransform({ p: 50, kind: "discount" }, { to: "c", from: "p", transform: "sign-when", whenField: "kind", equals: "discount" }), -50);
  assert.equal(applyTransform({ p: 50, kind: "labour" }, { to: "c", from: "p", transform: "sign-when", whenField: "kind", equals: "discount" }), 50);
  assert.equal(applyTransform({ r: 20 }, { to: "n", from: "r", transform: "const-when-gt", gt: 0, then: "Tax", else: "" }), "Tax");
  assert.equal(applyTransform({ r: 0 }, { to: "n", from: "r", transform: "const-when-gt", gt: 0, then: "Tax", else: "" }), "");
});

test("evalPredicate: equalsAny, numeric gates, anyOf/allOf", () => {
  assert.equal(evalPredicate({ s: 4 }, { field: "s", equalsAny: [4, "4"] }), true);
  assert.equal(evalPredicate({ s: "4" }, { field: "s", equalsAny: [4, "4"] }), true);
  assert.equal(evalPredicate({ s: 2 }, { field: "s", equalsAny: [4, "4"] }), false);
  assert.equal(evalPredicate({ b: 0, p: 5 }, { allOf: [{ field: "b", finite: true, lte: 0 }, { field: "p", finite: true, gt: 0 }] }), true);
  assert.equal(evalPredicate({ b: 1, p: 5 }, { allOf: [{ field: "b", finite: true, lte: 0 }, { field: "p", finite: true, gt: 0 }] }), false);
  assert.equal(evalPredicate({}, { anyOf: [{ field: "s", equalsAny: [4] }] }), false);
});

test("asRecord recognises plain objects only", () => {
  assert.deepEqual(asRecord({ a: 1 }), { a: 1 });
  assert.equal(asRecord([1, 2]), null);
  assert.equal(asRecord(null), null);
  assert.equal(asRecord("s"), null);
});
