import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOwnership } from "./ownership";
import type { StoreCapability } from "./types";

const cap = (storeId: string, role: StoreCapability["role"], fields: Record<string, [surface: boolean, store: boolean]>): StoreCapability => ({
  storeId,
  role,
  fields: Object.fromEntries(Object.entries(fields).map(([k, [surface, store]]) => [k, { surface, store }])),
});

test("writer is the highest-precedence store that can store the field; caches never write", () => {
  const plan = resolveOwnership([
    cap("cache", "cache", { title: [true, true] }), // cache claims store=true but must never win the writer
    cap("aug", "augmenting", { title: [true, true] }),
    cap("auth", "authoritative", { title: [true, true] }),
  ]);
  assert.equal(plan["title"]!.writerStoreId, "auth");
  // cache is read-only and always LAST in readOrder; augmenting is dropped (auth can store title).
  assert.deepEqual(plan["title"]!.readOrder, ["auth", "cache"]);
});

test("augmenting guard: an augmenting store is dropped from writer AND readOrder when an authoritative store can store the field", () => {
  const plan = resolveOwnership([
    cap("auth", "authoritative", { budget: [true, true] }),
    cap("aug", "augmenting", { budget: [true, true] }),
  ]);
  assert.equal(plan["budget"]!.writerStoreId, "auth");
  assert.deepEqual(plan["budget"]!.readOrder, ["auth"], "augmenting must not shadow authoritative, even authoritative-empty");
});

test("augmenting guard: augmenting MAY own+read a field NO authoritative store can store", () => {
  const plan = resolveOwnership([
    cap("auth", "authoritative", { title: [true, true] }), // auth cannot store `sentiment`
    cap("aug", "augmenting", { sentiment: [true, true] }),
  ]);
  assert.equal(plan["sentiment"]!.writerStoreId, "aug");
  assert.deepEqual(plan["sentiment"]!.readOrder, ["aug"]);
});

test("augmenting guard applies even when the authoritative store can store but not surface", () => {
  const plan = resolveOwnership([
    cap("auth", "authoritative", { secretField: [false, true] }), // store-only
    cap("aug", "augmenting", { secretField: [true, true] }),
  ]);
  assert.equal(plan["secretField"]!.writerStoreId, "auth");
  assert.deepEqual(plan["secretField"]!.readOrder, [], "augmenting dropped; auth can't surface ⇒ not surfaceable");
  assert.equal(plan["secretField"]!.surfaceable, false);
});

test("cache is appended last and never becomes the writer", () => {
  const plan = resolveOwnership([
    cap("cache", "cache", { title: [true, true] }),
    cap("auth", "authoritative", { title: [true, true] }),
  ]);
  assert.equal(plan["title"]!.writerStoreId, "auth");
  assert.deepEqual(plan["title"]!.readOrder, ["auth", "cache"]);
});

test("surfaceable=false ⇒ the field is absent (no store can surface it)", () => {
  const plan = resolveOwnership([cap("auth", "authoritative", { hidden: [false, true] })]);
  assert.equal(plan["hidden"]!.surfaceable, false);
  assert.equal(plan["hidden"]!.writerStoreId, "auth");
  assert.deepEqual(plan["hidden"]!.readOrder, []);
});

test("no store can store ⇒ writer is null (field becomes unpersistable on write)", () => {
  const plan = resolveOwnership([cap("auth", "authoritative", { readonly: [true, false] })]);
  assert.equal(plan["readonly"]!.writerStoreId, null);
  assert.deepEqual(plan["readonly"]!.readOrder, ["auth"]);
});
