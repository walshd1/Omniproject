import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { connectedBrokers, connectedBrokerKinds, brokersSupporting, brokerForCommand, brokerPurposeCount } from "./registry";
import { getBroker } from "./index";
import { getBrokerDef } from "@workspace/backend-catalogue";
import { updateSettings } from "../lib/settings";

// Tests run with no BROKER_URL ⇒ the active broker is the in-process demo
// (kind "demo", live false), which is always the PRIMARY connected broker.
const ACTIVE = getBroker().kind;

// Extra connected kinds come from the admin `brokerKinds` SETTING (the single source of truth).
const setKinds = (...kinds: string[]) => updateSettings({ brokerKinds: kinds });

afterEach(() => {
  updateSettings({ brokerKinds: [] });
});

test("connectedBrokers: the active broker is the sole, primary connection by default", () => {
  const connected = connectedBrokers();
  assert.deepEqual(connected, [{ kind: ACTIVE, live: getBroker().live, primary: true }]);
  assert.deepEqual(connectedBrokerKinds(), [ACTIVE]);
});

test("a broker maps ≥1 capability or it isn't loaded (no purpose → not connected)", () => {
  // Real catalogue kinds map at least one capability — so they have purpose and load.
  assert.ok(brokerPurposeCount("n8n") >= 1);
  setKinds("n8n");
  // Every connected broker has a purpose (>=1 mapped capability); none is padding.
  for (const b of connectedBrokers()) assert.ok(brokerPurposeCount(b.kind) >= 1 || b.primary, `${b.kind} has no purpose`);
  // A name that maps nothing contributes 0 and would be dropped by the load rule.
  assert.equal(brokerPurposeCount("totally-not-a-broker"), 0);
});

test("the brokerKinds setting declares extra connected kinds; active is primary + first, deduped", () => {
  setKinds("n8n", "make", "make");
  const kinds = connectedBrokerKinds();
  assert.equal(kinds[0], ACTIVE); // active stays primary + first
  assert.ok(kinds.includes("n8n") && kinds.includes("make")); // valid extras added
  assert.equal(new Set(kinds).size, kinds.length); // no dupes
  assert.equal(connectedBrokers().filter((b) => b.primary).length, 1); // exactly one primary
});

test("brokersSupporting: which connected kinds can serve a broker capability", () => {
  setKinds("n8n", "http-sidecar");
  // n8n provides managed per-connector auth; the raw http-sidecar does not — so the
  // routing primitive must include n8n but not http-sidecar for that capability.
  const managed = brokersSupporting("managedAuth");
  assert.equal(getBrokerDef("n8n")!.capabilities.managedAuth, true);
  assert.equal(getBrokerDef("http-sidecar")!.capabilities.managedAuth, false);
  assert.ok(managed.includes("n8n"));
  assert.ok(!managed.includes("http-sidecar"));
  // The demo primary simulates the full reference broker ⇒ matches every broker key.
  if (!getBroker().live) assert.ok(managed.includes(ACTIVE));
});

test("brokersSupporting: a non-capability key matches no live broker (only demo's reference match)", () => {
  setKinds("n8n");
  const who = brokersSupporting("not-a-capability");
  assert.ok(!who.includes("n8n"));
});

test("brokerForCommand: keeps the primary (live hop) whenever it qualifies", () => {
  // No intent ⇒ the primary serves it.
  assert.equal(brokerForCommand(), ACTIVE);
  // The demo primary simulates the full reference broker, so it qualifies for any
  // transport or known capability — it stays the target even with extra kinds wired.
  setKinds("n8n", "node-red");
  assert.ok(connectedBrokerKinds().includes("node-red"));
  assert.equal(brokerForCommand({ transport: "native-node" }), ACTIVE);
  assert.equal(brokerForCommand({ capability: "eventsOutbound" }), ACTIVE);
});

test("brokerForCommand: falls back to the primary when nothing is eligible", () => {
  setKinds("n8n");
  // A capability no connected broker supports ⇒ no one is eligible ⇒ fall back to
  // the primary rather than return nothing (the command still has a target).
  assert.equal(brokerForCommand({ capability: "not-a-capability" }), ACTIVE);
});
