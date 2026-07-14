import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { wrapWithMeter } from "./meter";
import { currentTotal } from "../lib/usage-metering";
import { __resetSharedStateForTest } from "../lib/shared-state";
import type { Broker, ActorContext } from "./types";

/**
 * Broker usage meter — counts each real backend read/write call per vendor into the fleet-wide meter,
 * passing non-I/O members through untouched, and never altering the wrapped result.
 */
beforeEach(() => __resetSharedStateForTest());

const ctx = {} as ActorContext;

function fakeBroker(): Broker {
  return {
    kind: "jira",
    async listProjects() { return [{ id: "p1" }] as never; },
    async updateProject(_c: ActorContext, id: string) { return { id } as never; },
  } as unknown as Broker;
}

test("a real read call is metered as one call to the vendor, result unchanged", async () => {
  const b = wrapWithMeter(fakeBroker(), () => "jira");
  const out = await b.listProjects(ctx);
  assert.deepEqual(out, [{ id: "p1" }]);
  assert.equal(await currentTotal("jira", "calls", "hour"), 1);
});

test("writes are metered too, and the vendor resolver is read per call", async () => {
  let vendor = "jira";
  const b = wrapWithMeter(fakeBroker(), () => vendor);
  await b.updateProject(ctx, "p1");
  vendor = "openproject";
  await b.updateProject(ctx, "p2");
  assert.equal(await currentTotal("jira", "calls", "hour"), 1);
  assert.equal(await currentTotal("openproject", "calls", "hour"), 1);
});

test("a non-I/O member (kind) passes through and is NOT metered", async () => {
  const b = wrapWithMeter(fakeBroker(), () => "jira");
  assert.equal(b.kind, "jira");
  assert.equal(await currentTotal("jira", "calls", "hour"), 0);
});
