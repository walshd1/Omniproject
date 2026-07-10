import { test } from "node:test";
import assert from "node:assert/strict";
import { scatter } from "./scatter";
import type { OwnershipPlan, StoreRole } from "./types";

const roles: Record<string, StoreRole> = { auth: "authoritative", aug: "augmenting", cache: "cache" };
const roleOf = (id: string): StoreRole => roles[id]!;

test("each field routes to its single writer; multiple fields to one store coalesce", () => {
  const plan: OwnershipPlan = {
    title: { writerStoreId: "auth", readOrder: ["auth"], surfaceable: true },
    budget: { writerStoreId: "auth", readOrder: ["auth"], surfaceable: true },
    sentiment: { writerStoreId: "aug", readOrder: ["aug"], surfaceable: true },
  };
  const { intents } = scatter({ plan, patch: { title: "T", budget: 5, sentiment: "warm" }, roleOf });
  const auth = intents.find((i) => i.storeId === "auth")!;
  assert.deepEqual(auth.fields, { title: "T", budget: 5 });
  assert.deepEqual(intents.find((i) => i.storeId === "aug")!.fields, { sentiment: "warm" });
});

test("intents are ordered authoritative-first", () => {
  const plan: OwnershipPlan = {
    sentiment: { writerStoreId: "aug", readOrder: ["aug"], surfaceable: true },
    title: { writerStoreId: "auth", readOrder: ["auth"], surfaceable: true },
  };
  const { intents } = scatter({ plan, patch: { sentiment: "warm", title: "T" }, roleOf });
  assert.deepEqual(intents.map((i) => i.storeId), ["auth", "aug"]);
});

test("a field with no writer is surfaced as unpersistable, never dropped", () => {
  const plan: OwnershipPlan = { readonly: { writerStoreId: null, readOrder: ["auth"], surfaceable: true } };
  const { intents, unpersistable } = scatter({ plan, patch: { readonly: "x" }, roleOf });
  assert.equal(intents.length, 0);
  assert.deepEqual(unpersistable, [{ field: "readonly", value: "x", reason: "no-writer" }]);
});

test("a field absent from the plan is unpersistable (nothing can persist it)", () => {
  const { unpersistable } = scatter({ plan: {}, patch: { rogue: 1 }, roleOf });
  assert.deepEqual(unpersistable, [{ field: "rogue", value: 1, reason: "no-writer" }]);
});
