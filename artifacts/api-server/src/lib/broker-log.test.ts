import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pushBrokerEvent, getBrokerLog, subscribeBrokerLog, brokerLogSize, clearBrokerLog } from "./broker-log";
import type { AuditEvent } from "./audit";

afterEach(() => clearBrokerLog());

function ev(over: Partial<AuditEvent> = {}): AuditEvent {
  return { ts: "2026-01-01T00:00:00Z", category: "broker", action: "list_projects", status: 200, ms: 12, result: "success", ...over };
}

test("pushBrokerEvent projects a redacted entry (no upstream body, error note kept)", () => {
  pushBrokerEvent(ev({ action: "create_issue", result: "error", status: 502, ms: 40, actor: { sub: "u1" }, projectId: "p1", meta: { error: "TimeoutError", upstreamBody: "SENSITIVE backend stack trace" } }));
  const [e] = getBrokerLog();
  assert.equal(e!.action, "create_issue");
  assert.equal(e!.result, "error");
  assert.equal(e!.status, 502);
  assert.equal(e!.actor, "u1");
  assert.equal(e!.note, "TimeoutError");
  // The raw upstream body must NOT leak into the admin log.
  assert.ok(!JSON.stringify(e).includes("SENSITIVE"));
});

test("derives result from status when not set", () => {
  pushBrokerEvent(ev({ result: undefined, status: 404 }));
  assert.equal(getBrokerLog()[0]!.result, "error");
  clearBrokerLog();
  pushBrokerEvent(ev({ result: undefined, status: 200 }));
  assert.equal(getBrokerLog()[0]!.result, "success");
});

test("the ring is bounded (never grows without limit)", () => {
  for (let i = 0; i < 600; i++) pushBrokerEvent(ev({ ms: i }));
  assert.ok(brokerLogSize() <= 500, `ring should be capped, got ${brokerLogSize()}`);
  // It keeps the most RECENT events (oldest evicted).
  const last = getBrokerLog().at(-1)!;
  assert.equal(last.ms, 599);
});

test("subscribers receive live entries and can unsubscribe", () => {
  const seen: string[] = [];
  const unsub = subscribeBrokerLog((e) => seen.push(e.action));
  pushBrokerEvent(ev({ action: "a" }));
  pushBrokerEvent(ev({ action: "b" }));
  unsub();
  pushBrokerEvent(ev({ action: "c" })); // after unsubscribe → not seen
  assert.deepEqual(seen, ["a", "b"]);
});
