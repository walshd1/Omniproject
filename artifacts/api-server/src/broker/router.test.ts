import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { endpointsForKind, routeBrokerCall } from "./router";
import { withEndpoints } from "./endpoint-context";
import { webhookPool } from "./n8n";
import { getBroker } from "./index";

const ACTIVE = getBroker().kind; // "demo" in tests (no BROKER_URL)

afterEach(() => {
  delete process.env["BROKER_ENDPOINTS"];
});

test("endpointsForKind parses BROKER_ENDPOINTS (per-kind URL, | pool, missing ⇒ undefined)", () => {
  process.env["BROKER_ENDPOINTS"] = "n8n=https://n8n/webhook|https://n8n2/webhook, node-red=http://localhost:1880/omniproject";
  assert.deepEqual(endpointsForKind("n8n"), ["https://n8n/webhook", "https://n8n2/webhook"]);
  assert.deepEqual(endpointsForKind("node-red"), ["http://localhost:1880/omniproject"]);
  assert.equal(endpointsForKind("make"), undefined); // not declared
  delete process.env["BROKER_ENDPOINTS"];
  assert.equal(endpointsForKind("n8n"), undefined); // nothing declared at all
});

test("withEndpoints binds the adapter pool to the routed endpoint for the call's scope", () => {
  // Outside any scope, the pool is the default/env target.
  const outside = webhookPool();
  withEndpoints(["http://routed-broker/omniproject"], () => {
    assert.deepEqual(webhookPool(), ["http://routed-broker/omniproject"]);
  });
  // Scope is restored afterwards.
  assert.deepEqual(webhookPool(), outside);
});

test("routeBrokerCall binds the call to the selected kind's declared endpoint", async () => {
  process.env["BROKER_ENDPOINTS"] = `${ACTIVE}=http://routed-${ACTIVE}/omniproject`;
  let seenInside: string[] = [];
  const result = await routeBrokerCall({}, async (broker) => {
    seenInside = webhookPool(); // what the adapter would dispatch to
    return broker.kind;
  });
  assert.equal(result, ACTIVE);
  assert.deepEqual(seenInside, [`http://routed-${ACTIVE}/omniproject`]);
});

test("routeBrokerCall with no declared endpoint falls back to the default (single-broker unchanged)", async () => {
  delete process.env["BROKER_ENDPOINTS"];
  const def = webhookPool();
  const seen = await routeBrokerCall({}, async () => webhookPool());
  assert.deepEqual(seen, def);
});
