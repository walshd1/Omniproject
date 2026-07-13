import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pushBrokerEvent, getBrokerLog, subscribeBrokerLog, brokerLogSize, clearBrokerLog, foldRemoteEntry, registerBrokerLogPublisher, brokerLogReplicaId, type BrokerLogEntry } from "./broker-log";
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

// ── Multi-replica fan-out ────────────────────────────────────────────────────

test("local entries are stamped with THIS replica's label (fleet attribution)", () => {
  pushBrokerEvent(ev({ action: "list_issues" }));
  assert.equal(getBrokerLog()[0]!.replica, brokerLogReplicaId());
});

test("foldRemoteEntry surfaces another replica's entry locally + notifies subscribers", () => {
  const seen: BrokerLogEntry[] = [];
  const unsub = subscribeBrokerLog((e) => seen.push(e));
  const remote: BrokerLogEntry = { ts: "2026-01-01T00:00:01Z", action: "create_issue", result: "success", status: 200, ms: 7, projectId: "p9", actor: "u-remote", note: null, replica: "node-B" };
  foldRemoteEntry(remote);
  unsub();
  // It appears in this replica's ring, keeping the originating node's label…
  const last = getBrokerLog().at(-1)!;
  assert.equal(last.replica, "node-B");
  assert.equal(last.action, "create_issue");
  // …and reached the live subscriber (so an admin watching node-A sees node-B).
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.replica, "node-B");
});

test("publishers get LOCAL entries but NOT folded remote ones (no echo storm)", () => {
  const published: BrokerLogEntry[] = [];
  const off = registerBrokerLogPublisher((e) => published.push(e));
  pushBrokerEvent(ev({ action: "local-one" }));               // local → published
  foldRemoteEntry({ ts: "t", action: "remote-one", result: "success", status: 200, ms: 1, projectId: null, actor: null, note: null, replica: "node-C" }); // remote → NOT re-published
  off();
  pushBrokerEvent(ev({ action: "after-unregister" }));        // publisher gone
  assert.deepEqual(published.map((e) => e.action), ["local-one"]);
});

test("foldRemoteEntry sanitises a hostile remote entry (clamps note, normalises fields; drops one with no ts)", () => {
  clearBrokerLog();
  // No ts → the entry is malformed and dropped entirely.
  foldRemoteEntry({ action: "x" } as unknown as BrokerLogEntry);
  assert.equal(brokerLogSize(), 0);
  // Oversized / wrong-typed fields → clamped + normalised, never injected raw into the admin log.
  foldRemoteEntry({ ts: "2026-01-01T00:00:00Z", action: "a".repeat(1000), result: "nope", status: "500", ms: NaN, projectId: 123, actor: "b".repeat(1000), note: "n".repeat(5000), replica: "r" } as unknown as BrokerLogEntry);
  const log = getBrokerLog();
  const e = log[log.length - 1]!;
  assert.equal(e.note!.length, 200);   // clamped like the local project() path
  assert.equal(e.result, "success");    // unknown result normalised
  assert.equal(e.status, 0);            // non-number status → 0
  assert.equal(e.ms, 0);                // NaN → 0
  assert.equal(e.projectId, null);      // non-string → null
  assert.ok(e.action.length <= 400);    // bounded
});
