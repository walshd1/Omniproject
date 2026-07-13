import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapWithScopeGuard } from "./scope-guard";
import { BrokerError, type ActorContext, type Broker } from "./types";
import type { Scope } from "../lib/scope";

/**
 * Data-seam scope guard — the defense-in-depth backstop that re-enforces the caller's data scope at the
 * first-party broker so a MISSING gateway guard can't leak cross-scope project data. Uses a minimal fake
 * broker whose listProjects returns two projects in different programmes.
 */

const PROJECTS = [
  { id: "proj-a", programmeId: "prog-alpha" },
  { id: "proj-b", programmeId: "prog-beta" },
];

/** A fake broker that records the last per-project call it actually served. */
function makeFake(): { broker: Broker; served: string[] } {
  const served: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broker = {
    async listProjects() { return PROJECTS as any; },
    async projectSummary(_ctx: ActorContext, projectId: string) { served.push(`summary:${projectId}`); return { projectId } as any; },
    async projectFinancials(_ctx: ActorContext, projectId: string) { served.push(`fin:${projectId}`); return { projectId } as any; },
  } as unknown as Broker;
  return { broker, served };
}

const ctxWith = (scope: Scope | undefined): ActorContext => ({ sub: "u1", ...(scope ? { scope } : {}) }) as ActorContext;

test("all-scope passes straight through (no enforcement)", async () => {
  const { broker, served } = makeFake();
  const guarded = wrapWithScopeGuard(broker);
  await guarded.projectSummary(ctxWith({ level: "all" }), "proj-b");
  assert.deepEqual(served, ["summary:proj-b"]);
});

test("a system/no-scope call passes through (internal calls unaffected)", async () => {
  const { broker, served } = makeFake();
  const guarded = wrapWithScopeGuard(broker);
  await guarded.projectFinancials(ctxWith(undefined), "proj-a");
  assert.deepEqual(served, ["fin:proj-a"]);
});

test("a programme principal is served an IN-scope project", async () => {
  const { broker, served } = makeFake();
  const guarded = wrapWithScopeGuard(broker);
  await guarded.projectSummary(ctxWith({ level: "programme", programmes: ["prog-alpha"] }), "proj-a");
  assert.deepEqual(served, ["summary:proj-a"]);
});

test("a programme principal is REFUSED an out-of-scope project (data-seam backstop)", async () => {
  const { broker, served } = makeFake();
  const guarded = wrapWithScopeGuard(broker);
  await assert.rejects(
    () => guarded.projectSummary(ctxWith({ level: "programme", programmes: ["prog-alpha"] }), "proj-b"),
    (err) => err instanceof BrokerError && /not in your scope/.test(err.message),
  );
  assert.deepEqual(served, [], "the broker method must NOT run for an out-of-scope project");
});

test("an unknown project id is refused (fail-closed, not served)", async () => {
  const { broker, served } = makeFake();
  const guarded = wrapWithScopeGuard(broker);
  await assert.rejects(
    () => guarded.projectFinancials(ctxWith({ level: "programme", programmes: ["prog-alpha"] }), "ghost"),
    (err) => err instanceof BrokerError,
  );
  assert.deepEqual(served, []);
});

test("a user-level principal is served any VISIBLE project (boundary is visibility, mirrors the gateway)", async () => {
  const { broker, served } = makeFake();
  const guarded = wrapWithScopeGuard(broker);
  await guarded.projectSummary(ctxWith({ level: "user", sub: "u1" }), "proj-b");
  assert.deepEqual(served, ["summary:proj-b"]);
});
