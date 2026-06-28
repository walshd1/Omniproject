import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoBroker } from "./demo";
import type { ActorContext } from "./types";

/**
 * The demo broker's change token is stable while data is unchanged, moves when it
 * changes, and is null for resources with no cheap version.
 */
const ctx = {} as ActorContext;

test("changeToken is stable for an unchanged resource", async () => {
  const b = new DemoBroker();
  const a = await b.changeToken(ctx, "projects");
  const c = await b.changeToken(ctx, "projects");
  assert.ok(a);
  assert.equal(a, c);
});

test("changeToken moves after the resource is mutated", async () => {
  const b = new DemoBroker();
  const before = await b.changeToken(ctx, "projects");
  await b.createProject(ctx, { name: "Conditional Co", identifier: "CND" } as never);
  const after = await b.changeToken(ctx, "projects");
  assert.notEqual(before, after, "the token must change when projects change");
});

test("changeToken is null for resources with no cheap version (volatile)", async () => {
  const b = new DemoBroker();
  assert.equal(await b.changeToken(ctx, "activity"), null);
  assert.equal(await b.changeToken(ctx, "fx"), null);
});

test("issue tokens are per-project", async () => {
  const b = new DemoBroker();
  const t1 = await b.changeToken(ctx, "issues:proj-001");
  const t2 = await b.changeToken(ctx, "issues:proj-002");
  // distinct projects ⇒ distinct slices (or both null, but proj-001 has issues)
  assert.ok(t1);
  assert.notEqual(t1, t2);
});
