import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  onDomainEvent, emitDomainEvent, buildDomainEvent, emitEntityWrite,
  domainEventsEnabled, domainEventHandlerCount, type DomainEvent,
} from "./domain-event";

/**
 * Domain-event emitter — the "ON" of the rules engine. In-process (never cross-replica, so a rule runs once)
 * and out-of-band (scheduled on the next tick; a throwing/slow handler can't touch the write path).
 */

const tick = () => new Promise((r) => setImmediate(r));

const ev = (over: Partial<DomainEvent> = {}): DomainEvent => ({
  id: "evt-1", surface: "task", verb: "created", triggerKind: "task.created",
  subject: { id: "t1", status: "next" }, scope: { projectId: "p1" },
  actor: { sub: "u1", role: "manager", actorKind: "human" },
  causation: { depth: 0, rootEventId: "evt-1", rulePath: [] }, at: 1,
  ...over,
});

test("domainEventsEnabled reads the off-by-default flag", () => {
  assert.equal(domainEventsEnabled({}), false);
  assert.equal(domainEventsEnabled({ RULES_ENGINE_EVENTS: "1" }), true);
  assert.equal(domainEventsEnabled({ RULES_ENGINE_EVENTS: "false" }), false);
});

test("emit delivers to every subscriber, out-of-band, and unsubscribe stops delivery", async () => {
  const seen: string[] = [];
  const off1 = onDomainEvent((e) => { seen.push(`a:${e.triggerKind}`); });
  const off2 = onDomainEvent((e) => { seen.push(`b:${e.id}`); });
  emitDomainEvent(ev());
  assert.deepEqual(seen, [], "delivery is scheduled, not synchronous"); // out-of-band
  await tick();
  assert.deepEqual(seen.sort(), ["a:task.created", "b:evt-1"]);
  off1();
  emitDomainEvent(ev({ id: "evt-2" }));
  await tick();
  assert.deepEqual(seen.sort(), ["a:task.created", "b:evt-1", "b:evt-2"]); // only b still subscribed
  off2();
  assert.equal(domainEventHandlerCount(), 0);
});

test("a throwing handler is swallowed and does not stop the others", async () => {
  const seen: string[] = [];
  const offBad = onDomainEvent(() => { throw new Error("boom"); });
  const offGood = onDomainEvent(() => { seen.push("ok"); });
  assert.doesNotThrow(() => emitDomainEvent(ev()));
  await tick();
  assert.deepEqual(seen, ["ok"]);
  offBad(); offGood();
});

test("emit is a no-op with no subscribers", () => {
  assert.equal(domainEventHandlerCount(), 0);
  assert.doesNotThrow(() => emitDomainEvent(ev()));
});

test("buildDomainEvent stamps triggerKind + a depth-0 causation root; a direct write is its own root", () => {
  const req = { headers: {}, params: { taskId: "t9" } } as unknown as Request;
  const e = buildDomainEvent(req, "task", "status-changed", { id: "t9", status: "waiting" }, { projectId: "p1" });
  assert.equal(e.triggerKind, "task.status-changed");
  assert.equal(e.verb, "status-changed");
  assert.equal(e.causation.depth, 0);
  assert.equal(e.causation.rootEventId, e.id); // its own root
  assert.deepEqual(e.causation.rulePath, []);
  assert.equal(e.actor.actorKind, "human");
});

test("emitEntityWrite maps the pipeline verb and merges params+body+result into the subject", async () => {
  const seen: DomainEvent[] = [];
  const off = onDomainEvent((e) => { seen.push(e); });
  const req = { headers: {}, params: { taskId: "t1" } } as unknown as Request;
  emitEntityWrite(req, "task", "update", "p1", { body: { status: "waiting" }, result: { id: "t1", status: "waiting", assignee: "u2" } });
  await tick();
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.triggerKind, "task.updated"); // update -> updated
  assert.equal(seen[0]!.subject["taskId"], "t1");     // route param
  assert.equal(seen[0]!.subject["assignee"], "u2");   // result field
  assert.equal(seen[0]!.scope.projectId, "p1");
  off();
});

test("emitEntityWrite ignores an op with no event verb mapping", async () => {
  let count = 0;
  const off = onDomainEvent(() => { count++; });
  emitEntityWrite({ headers: {}, params: {} } as unknown as Request, "task", "frobnicate", null, {});
  await tick();
  assert.equal(count, 0);
  off();
});
