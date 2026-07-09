import { test } from "node:test";
import assert from "node:assert/strict";
import { Compositor } from "./compositor";
import type { FieldSupport, StoreAdapter, StoreCapability, StoreFragment, StoreRole } from "./types";

/** A hand-built, injectable StoreAdapter double — no Postgres, no broker. */
function fakeAdapter(opts: {
  storeId: string;
  role: StoreRole;
  fields: Record<string, [surface: boolean, store: boolean]>;
  rows?: Record<string, Record<string, unknown>>;
  throwOnRead?: boolean;
  throwOnWrite?: boolean;
  asOf?: string;
  writes?: { id: string; fields: Record<string, unknown> }[];
}): StoreAdapter {
  const support: Record<string, FieldSupport> = Object.fromEntries(
    Object.entries(opts.fields).map(([k, [surface, store]]) => [k, { surface, store }]),
  );
  return {
    storeId: opts.storeId,
    role: opts.role,
    capability: (): StoreCapability => ({ storeId: opts.storeId, role: opts.role, fields: support }),
    read: async (_entity, ids): Promise<StoreFragment[]> => {
      if (opts.throwOnRead) throw new Error("down");
      return ids.map((id) => ({ storeId: opts.storeId, role: opts.role, ...(opts.asOf ? { asOf: opts.asOf } : {}), values: opts.rows?.[id] ?? {} }));
    },
    write: async (_entity, id, fields): Promise<void> => {
      if (opts.throwOnWrite) throw new Error("write failed");
      opts.writes?.push({ id, fields });
    },
    asOf: () => opts.asOf,
  };
}

test("readComposite: a throwing store degrades to an honest partial, doesn't fail the read", async () => {
  const auth = fakeAdapter({ storeId: "auth", role: "authoritative", fields: { title: [true, true], budget: [true, true] }, throwOnRead: true });
  const aug = fakeAdapter({ storeId: "aug", role: "augmenting", fields: { sentiment: [true, true] }, rows: { "1": { sentiment: "warm" } } });
  const c = new Compositor([auth, aug]);
  const [rec] = await c.readComposite("issue", ["1"]);
  // auth is down ⇒ its owned fields are unavailable; the augmenting-only field still resolves.
  assert.equal(rec!.fields["title"]!.availability, "unavailable");
  assert.equal(rec!.fields["budget"]!.availability, "unavailable");
  assert.equal(rec!.fields["sentiment"]!.availability, "present");
  assert.equal(rec!.fields["sentiment"]!.value, "warm");
});

test("writeComposite: a failing augmenting write yields an honest partial (authoritative applied, no rollback)", async () => {
  const authWrites: { id: string; fields: Record<string, unknown> }[] = [];
  const auth = fakeAdapter({ storeId: "auth", role: "authoritative", fields: { title: [true, true] }, writes: authWrites });
  const aug = fakeAdapter({ storeId: "aug", role: "augmenting", fields: { sentiment: [true, true] }, throwOnWrite: true });
  const c = new Compositor([auth, aug]);
  const res = await c.writeComposite("issue", "1", { title: "New", sentiment: "warm" });
  assert.equal(res.ok, false);
  assert.equal(res.partial, true, "some applied, some failed ⇒ partial");
  assert.deepEqual(res.applied, [{ storeId: "auth", fields: ["title"] }]);
  assert.deepEqual(authWrites, [{ id: "1", fields: { title: "New" } }], "authoritative write executed first and stuck");
});

test("writeComposite: a field with no writer is surfaced as unpersistable", async () => {
  const auth = fakeAdapter({ storeId: "auth", role: "authoritative", fields: { title: [true, false] } }); // read-only field
  const c = new Compositor([auth]);
  const res = await c.writeComposite("issue", "1", { title: "x" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.unpersistable, [{ field: "title", value: "x", reason: "no-writer" }]);
});

test("the compositor is stateless — repeated reads accumulate no state and are pure functions of the stores", async () => {
  const auth = fakeAdapter({ storeId: "auth", role: "authoritative", fields: { title: [true, true] }, rows: { "1": { title: "A" } } });
  const c = new Compositor([auth]);
  const first = await c.readComposite("issue", ["1"]);
  const second = await c.readComposite("issue", ["1"]);
  assert.deepEqual(first, second);
});
