import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { wrapWithAutonomousGuard } from "./autonomous-guard";
import type { ActorContext, Broker } from "./types";
import { registerAutonomousGrant, __resetAutonomousGrants, AutonomousWriteDenied } from "../lib/autonomous-grant";
import { mintAutonomousContext } from "../lib/autonomous";
import { setContainmentRelax, __resetContainmentRelax } from "../lib/ai-containment";

/**
 * The always-on broker guard enforces authorizeAutonomousWrite on every write: a human context passes
 * straight through, an autonomous actor's write is bounded by its grant (fail-closed with no grant).
 */
afterEach(() => { __resetAutonomousGrants(); __resetContainmentRelax(); });

const NOW = 1_700_000_000_000;

/** A minimal fake broker that records the writes that actually reached it. */
function fakeBroker(): { broker: Broker; writes: string[] } {
  const writes: string[] = [];
  const broker = {
    writeIssue: async (_ctx: ActorContext, op: string, input: Record<string, unknown>) => { writes.push(`${op}:${String(input["projectId"])}`); return null; },
    listIssues: async () => [],
  } as unknown as Broker;
  return { broker, writes };
}

test("a human context passes straight through the guard (no autonomous constraint)", async () => {
  const { broker, writes } = fakeBroker();
  const guarded = wrapWithAutonomousGuard(broker, { now: () => NOW });
  await guarded.writeIssue({ sub: "user:alice", role: "manager" } as ActorContext, "update", { projectId: "p1", status: "done" });
  assert.deepEqual(writes, ["update:p1"]); // reached the broker
});

test("an autonomous actor with NO grant is denied before the write reaches the broker", async () => {
  setContainmentRelax("off");
  const { broker, writes } = fakeBroker();
  const guarded = wrapWithAutonomousGuard(broker, { now: () => NOW });
  const ctx = mintAutonomousContext({ id: "health-watch", role: "contributor" }, NOW);
  await assert.rejects(
    () => guarded.writeIssue(ctx, "update", { projectId: "p1", status: "done" }),
    AutonomousWriteDenied,
  );
  assert.deepEqual(writes, [], "the denied write never touched the broker");
});

test("an autonomous actor WITH a matching grant is allowed through the guard", async () => {
  setContainmentRelax("off");
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"] });
  const { broker, writes } = fakeBroker();
  const guarded = wrapWithAutonomousGuard(broker, { now: () => NOW });
  const ctx = mintAutonomousContext({ id: "health-watch", role: "contributor" }, NOW);
  await guarded.writeIssue(ctx, "update", { projectId: "p1", status: "done" });
  assert.deepEqual(writes, ["update:p1"]); // grant satisfied ⇒ reached the broker
});

test("the grant is action-scoped: a granted actor writing a DIFFERENT action is denied", async () => {
  setContainmentRelax("off");
  registerAutonomousGrant({ actorId: "health-watch", actions: ["update_issue"], projects: ["*"] });
  const { broker, writes } = fakeBroker();
  const guarded = wrapWithAutonomousGuard(broker, { now: () => NOW });
  const ctx = mintAutonomousContext({ id: "health-watch", role: "contributor" }, NOW);
  // delete_issue is not in the grant's actions → denied.
  await assert.rejects(() => guarded.writeIssue(ctx, "delete", { projectId: "p1" }), AutonomousWriteDenied);
  assert.deepEqual(writes, []);
});

test("reads are untouched by the guard", async () => {
  const { broker } = fakeBroker();
  const guarded = wrapWithAutonomousGuard(broker, { now: () => NOW });
  assert.deepEqual(await guarded.listIssues({ sub: "user:alice" } as ActorContext, "p1"), []);
});
