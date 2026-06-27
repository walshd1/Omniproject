import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { connectedBrokers, connectedBrokerKinds, brokersSupporting } from "./registry";
import { getBroker } from "./index";
import { getBrokerDef } from "@workspace/backend-catalogue";

// Tests run with no BROKER_URL ⇒ the active broker is the in-process demo
// (kind "demo", live false), which is always the PRIMARY connected broker.
const ACTIVE = getBroker().kind;

afterEach(() => {
  delete process.env["BROKER_KINDS"];
});

test("connectedBrokers: the active broker is the sole, primary connection by default", () => {
  delete process.env["BROKER_KINDS"];
  const connected = connectedBrokers();
  assert.deepEqual(connected, [{ kind: ACTIVE, live: getBroker().live, primary: true }]);
  assert.deepEqual(connectedBrokerKinds(), [ACTIVE]);
});

test("BROKER_KINDS declares extra connected kinds; unknown ids are dropped, active not duplicated", () => {
  process.env["BROKER_KINDS"] = `n8n, make , ${ACTIVE}, totally-not-a-broker`;
  const kinds = connectedBrokerKinds();
  // Active stays primary + first; valid extras added once; bogus dropped; no dupes.
  assert.equal(kinds[0], ACTIVE);
  assert.ok(kinds.includes("n8n") && kinds.includes("make"));
  assert.ok(!kinds.includes("totally-not-a-broker"));
  assert.equal(new Set(kinds).size, kinds.length);
  // Exactly one primary.
  assert.equal(connectedBrokers().filter((b) => b.primary).length, 1);
});

test("brokersSupporting: which connected kinds can serve a broker capability", () => {
  process.env["BROKER_KINDS"] = "n8n,http-sidecar";
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
  process.env["BROKER_KINDS"] = "n8n";
  const who = brokersSupporting("not-a-capability");
  assert.ok(!who.includes("n8n"));
});
