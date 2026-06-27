import { test } from "node:test";
import assert from "node:assert/strict";
import { BROKERS, brokerCatalogue, getBrokerDef, brokersForTransport, brokerSupport, brokerSupportUnion, BROKER_CAPABILITY_KEYS } from "./broker-catalogue";
import { unionSupport, isCapabilityMet } from "./compatibility";

test("the broker registry lists every supported broker with a build method", () => {
  const ids = BROKERS.map((b) => b.id).sort();
  assert.deepEqual(ids, ["http-sidecar", "make", "n8n", "pipedream", "power-automate", "serverless"]);
  for (const b of BROKERS) {
    assert.ok(b.label && b.docsUrl && b.build, `${b.id} missing fields`);
    assert.ok(typeof b.capabilities.synchronous === "boolean");
  }
});

test("INVARIANT: the broker plane is synchronous-only — every broker can be the live data hop", () => {
  // The defining trait of a broker. Async-only platforms (Airflow, Zapier) live in
  // the outputs/notifications planes, not here; the broker schema enforces
  // `synchronous: true`, and this guard backs it so a non-synchronous broker can
  // never slip in.
  for (const b of BROKERS) assert.equal(b.capabilities.synchronous, true, `${b.id} must be synchronous`);
  assert.ok(brokerCatalogue().every((b) => b.dataBroker), "every broker is a data broker");
});

test("capabilities and the build tool are separate but linked per broker", () => {
  const n8n = getBrokerDef("n8n");
  assert.equal(n8n?.build, "workflow-generator");
  assert.ok(n8n?.capabilities.synchronous);
  assert.deepEqual(n8n?.transports, ["http", "native-node"]);
});

test("async-only platforms are NOT brokers — Airflow lives in the outputs plane", () => {
  // The category correction: Airflow can't serve a synchronous read-through, so it
  // is not a broker. It is no longer in the broker catalogue at all.
  assert.equal(getBrokerDef("airflow"), undefined);
});

test("brokersForTransport is derived from capabilities (synchronous + transport)", () => {
  // HTTP: every (synchronous) HTTP broker.
  const http = brokersForTransport("http");
  assert.ok(http.includes("n8n") && http.includes("make") && http.includes("pipedream") && http.includes("serverless"));
  // native-node: n8n only.
  assert.deepEqual(brokersForTransport("native-node"), ["n8n"]);
});

test("Make, Pipedream, Power Automate and serverless are all synchronous data brokers", () => {
  for (const id of ["make", "pipedream", "power-automate", "serverless", "http-sidecar"]) {
    assert.equal(getBrokerDef(id)?.capabilities.synchronous, true, `${id} should be synchronous`);
  }
});

test("brokerSupport flattens a broker's capability flags into a key→boolean map", () => {
  const n8n = brokerSupport("n8n");
  // Every broker capability key is present and matches the definition.
  for (const k of BROKER_CAPABILITY_KEYS) assert.equal(n8n[k], getBrokerDef("n8n")!.capabilities[k]);
  // Unknown id ⇒ contributes nothing (so the resolver simply skips it).
  assert.deepEqual(brokerSupport("nope"), {});
});

test("brokerSupportUnion ORs capability support across connected brokers", () => {
  // A key is supported if ANY connected broker supports it. http-sidecar lacks
  // managedAuth where n8n has it — so the OR must light it up.
  const union = brokerSupportUnion(["n8n", "http-sidecar"]);
  for (const k of BROKER_CAPABILITY_KEYS) {
    const anyOn = getBrokerDef("n8n")!.capabilities[k] || getBrokerDef("http-sidecar")!.capabilities[k];
    assert.equal(!!union[k], anyOn, `${k} should be the OR across the two brokers`);
  }
  // Only truthy keys appear (false flags are absent, not `false`).
  for (const v of Object.values(union)) assert.equal(v, true);
  assert.deepEqual(brokerSupportUnion([]), {});
});

test("unionSupport folds backend domains + broker keys into ONE support set, taking only true flags", () => {
  // A backend-shaped object carries strings/objects too — only its boolean-true keys are taken.
  const backend = { issues: true, financials: false, mode: "demo", fields: {} } as Record<string, unknown>;
  const broker = brokerSupportUnion(["n8n"]);
  const support = unionSupport(backend, broker);
  assert.equal(support["issues"], true);
  assert.equal("financials" in support, false); // false flag dropped
  assert.equal("mode" in support, false); // non-boolean dropped
  // A report needing a backend domain and an event surface needing a broker key are
  // both gated by the SAME predicate over this one map.
  assert.equal(isCapabilityMet("issues", support), true);
  assert.equal(isCapabilityMet("eventsOutbound", support), !!getBrokerDef("n8n")!.capabilities.eventsOutbound);
  assert.equal(isCapabilityMet("financials", support), false);
});
