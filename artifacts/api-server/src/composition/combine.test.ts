import { test } from "node:test";
import assert from "node:assert/strict";
import { combine, isPartial } from "./combine";
import type { OwnershipPlan, StoreFragment } from "./types";

const plan = (o: OwnershipPlan): OwnershipPlan => o;

test("a present value wins, tagged sourced + live", () => {
  const p = plan({ title: { writerStoreId: "auth", readOrder: ["auth", "cache"], surfaceable: true } });
  const frags: StoreFragment[] = [
    { storeId: "auth", role: "authoritative", values: { title: "Real" } },
    { storeId: "cache", role: "cache", asOf: "2026-01-01", values: { title: "Stale" } },
  ];
  const r = combine({ id: "1", plan: p, fragments: frags });
  assert.equal(r.fields["title"]!.availability, "present");
  assert.equal(r.fields["title"]!.value, "Real");
  assert.equal(r.fields["title"]!.provenance, "sourced");
  assert.deepEqual(r.fields["title"]!.freshness, { kind: "live" });
  assert.equal(r.fields["title"]!.storeId, "auth");
});

test("an OWNING store that returns empty stops the search — authoritative empty is not overridden", () => {
  const p = plan({ budget: { writerStoreId: "auth", readOrder: ["auth", "aug"], surfaceable: true } });
  const frags: StoreFragment[] = [
    { storeId: "auth", role: "authoritative", values: {} }, // owner up, no value ⇒ real empty
    { storeId: "aug", role: "augmenting", values: { budget: 999 } }, // must NOT shadow
  ];
  const r = combine({ id: "1", plan: p, fragments: frags });
  assert.equal(r.fields["budget"]!.availability, "empty");
  assert.equal(r.fields["budget"]!.storeId, "auth");
});

test("a downed OWNER is skipped but remembered — fall through then report unavailable if nothing found", () => {
  const p = plan({ budget: { writerStoreId: "auth", readOrder: ["auth", "cache"], surfaceable: true } });
  const frags: StoreFragment[] = [
    { storeId: "auth", role: "authoritative", values: {}, unavailableFields: ["budget"] }, // owner down
    { storeId: "cache", role: "cache", asOf: "2026-01-01", values: {} }, // cache empty too
  ];
  const r = combine({ id: "1", plan: p, fragments: frags });
  assert.equal(r.fields["budget"]!.availability, "unavailable");
  assert.equal(r.fields["budget"]!.storeId, null);
});

test("downed owner falls through to a cache hit → sourced provenance with cached freshness", () => {
  const p = plan({ budget: { writerStoreId: "auth", readOrder: ["auth", "cache"], surfaceable: true } });
  const frags: StoreFragment[] = [
    { storeId: "auth", role: "authoritative", values: {}, unavailableFields: ["budget"] },
    { storeId: "cache", role: "cache", asOf: "2026-01-01T00:00:00Z", values: { budget: 42 } },
  ];
  const r = combine({ id: "1", plan: p, fragments: frags });
  assert.equal(r.fields["budget"]!.availability, "present");
  assert.equal(r.fields["budget"]!.value, 42);
  assert.equal(r.fields["budget"]!.provenance, "sourced");
  assert.deepEqual(r.fields["budget"]!.freshness, { kind: "cached", asOf: "2026-01-01T00:00:00Z" });
});

test("not surfaceable ⇒ absent (distinct from empty)", () => {
  const p = plan({ hidden: { writerStoreId: "auth", readOrder: [], surfaceable: false } });
  const r = combine({ id: "1", plan: p, fragments: [] });
  assert.equal(r.fields["hidden"]!.availability, "absent");
});

test("nothing found and no owner down ⇒ empty", () => {
  const p = plan({ note: { writerStoreId: null, readOrder: ["aug"], surfaceable: true } });
  const frags: StoreFragment[] = [{ storeId: "aug", role: "augmenting", values: {} }];
  const r = combine({ id: "1", plan: p, fragments: frags });
  assert.equal(r.fields["note"]!.availability, "empty");
});

test("0 and false are present, not empty", () => {
  const p = plan({ count: { writerStoreId: "auth", readOrder: ["auth"], surfaceable: true } });
  const r = combine({ id: "1", plan: p, fragments: [{ storeId: "auth", role: "authoritative", values: { count: 0 } }] });
  assert.equal(r.fields["count"]!.availability, "present");
  assert.equal(r.fields["count"]!.value, 0);
});

test("isPartial is true iff a field is unavailable", () => {
  const p = plan({ a: { writerStoreId: "auth", readOrder: ["auth"], surfaceable: true } });
  const present = combine({ id: "1", plan: p, fragments: [{ storeId: "auth", role: "authoritative", values: { a: 1 } }] });
  const down = combine({ id: "1", plan: p, fragments: [{ storeId: "auth", role: "authoritative", values: {}, unavailableFields: ["a"] }] });
  assert.equal(isPartial(present), false);
  assert.equal(isPartial(down), true);
});
