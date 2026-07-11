import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "./canonical-json";

/**
 * Pins the exact byte output of the shared canonical serializer. These hashes/MACs are persisted
 * and verified across replicas/restarts, so the output shape is a stable contract — a change here
 * that isn't a deliberate, coordinated re-hash is a bug. The golden strings below are what BOTH
 * former copies (snapshot's canonicalJson + provenance's canonical) produced.
 */

test("primitives encode as standard JSON", () => {
  assert.equal(canonicalJson(42), "42");
  assert.equal(canonicalJson("a\"b"), '"a\\"b"');
  assert.equal(canonicalJson(true), "true");
  assert.equal(canonicalJson(null), "null");
});

test("undefined (top-level and as a property) is treated as null / dropped", () => {
  assert.equal(canonicalJson(undefined), "null");
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
});

test("object keys are sorted recursively, order-independent", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalJson({ b: { d: 4, c: 3 }, a: 1 }), '{"a":1,"b":{"c":3,"d":4}}');
  // Byte-identical regardless of construction order.
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
});

test("arrays preserve order; their elements are canonicalised", () => {
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
  assert.equal(canonicalJson([{ b: 1, a: 2 }]), '[{"a":2,"b":1}]');
});

test("empty object / array and nesting", () => {
  assert.equal(canonicalJson({ empty: {}, arr: [] }), '{"arr":[],"empty":{}}');
  assert.equal(canonicalJson([[1, [2, { b: 1, a: 0 }]]]), '[[1,[2,{"a":0,"b":1}]]]');
});
