import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { wrapWithSingleFlight, singleFlightStats, resetSingleFlightStats } from "./single-flight";
import type { Broker } from "./types";

/**
 * Single-flight coalescing: concurrent identical READS share one upstream call; writes never do;
 * a settled call lets the next request fetch fresh. No staleness — coalesced callers share the
 * one live result. Per-actor keys keep one user's read from being served to another.
 */

beforeEach(() => resetSingleFlightStats());

/** A stub broker counting how many times each method actually runs upstream. */
function stubBroker() {
  const counts: Record<string, number> = {};
  const pending: Array<(v: unknown) => void> = [];
  const base = {
    listIssues(actor: { sub: string }, projectId: string) {
      counts["listIssues"] = (counts["listIssues"] ?? 0) + 1;
      // Stay pending until released, so we can line up concurrent callers.
      return new Promise<void>((res) => { pending.push(res); }).then(() => ({ actor: actor.sub, projectId }));
    },
    async writeIssue(_actor: unknown, id: string) {
      counts["writeIssue"] = (counts["writeIssue"] ?? 0) + 1;
      return { id };
    },
  } as unknown as Broker;
  // Resolve every upstream call currently in flight.
  return { base, counts, release: () => { while (pending.length) pending.shift()!(undefined); } };
}

test("concurrent identical reads collapse to one upstream call", async () => {
  const { base, counts, release } = stubBroker();
  const b = wrapWithSingleFlight(base) as unknown as { listIssues: (a: unknown, p: string) => Promise<unknown> };
  const actor = { sub: "u1" };
  const p1 = b.listIssues(actor, "proj-1");
  const p2 = b.listIssues(actor, "proj-1");
  const p3 = b.listIssues(actor, "proj-1");
  release();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(counts["listIssues"], 1, "only one upstream call");
  assert.deepEqual(r1, r2);
  assert.deepEqual(r2, r3);
  assert.deepEqual(singleFlightStats(), { calls: 1, coalesced: 2 });
});

test("a different actor is never coalesced into another's read", async () => {
  const { base, counts, release } = stubBroker();
  const b = wrapWithSingleFlight(base) as unknown as { listIssues: (a: unknown, p: string) => Promise<unknown> };
  const p1 = b.listIssues({ sub: "u1" }, "proj-1");
  const p2 = b.listIssues({ sub: "u2" }, "proj-1");
  release();
  await Promise.all([p1, p2]);
  assert.equal(counts["listIssues"], 2, "distinct actors → distinct upstream calls");
});

test("after a read settles, the next identical read fetches again (no staleness)", async () => {
  const { base, counts, release } = stubBroker();
  const b = wrapWithSingleFlight(base) as unknown as { listIssues: (a: unknown, p: string) => Promise<unknown> };
  const actor = { sub: "u1" };
  const first = b.listIssues(actor, "proj-1");
  release();
  await first;
  const second = b.listIssues(actor, "proj-1");
  release();
  await second;
  assert.equal(counts["listIssues"], 2, "sequential reads are not coalesced");
});

test("writes are never coalesced", async () => {
  const { base, counts } = stubBroker();
  const b = wrapWithSingleFlight(base) as unknown as { writeIssue: (a: unknown, id: string) => Promise<unknown> };
  await Promise.all([b.writeIssue({ sub: "u1" }, "i1"), b.writeIssue({ sub: "u1" }, "i1")]);
  assert.equal(counts["writeIssue"], 2);
});
