import { test } from "node:test";
import assert from "node:assert/strict";
import { BROKERS, brokerCatalogue, getBrokerDef, brokersForTransport } from "./broker-catalogue";

test("the broker registry lists every supported broker with a build method", () => {
  const ids = BROKERS.map((b) => b.id).sort();
  assert.deepEqual(ids, ["airflow", "http-sidecar", "make", "n8n", "pipedream", "power-automate", "serverless"]);
  for (const b of BROKERS) {
    assert.ok(b.label && b.docsUrl && b.build, `${b.id} missing fields`);
    assert.ok(typeof b.capabilities.synchronous === "boolean");
  }
});

test("capabilities and the build tool are separate but linked per broker", () => {
  const n8n = getBrokerDef("n8n");
  assert.equal(n8n?.build, "workflow-generator");
  assert.ok(n8n?.capabilities.synchronous);
  assert.deepEqual(n8n?.transports, ["http", "native-node"]);
});

test("Airflow is honestly modelled as async — NOT a live data broker", () => {
  const airflow = getBrokerDef("airflow");
  assert.equal(airflow?.capabilities.synchronous, false);
  assert.equal(brokerCatalogue().find((b) => b.id === "airflow")?.dataBroker, false);
});

test("brokersForTransport is derived from capabilities (synchronous + transport)", () => {
  // HTTP: every synchronous HTTP broker, never async Airflow.
  const http = brokersForTransport("http");
  assert.ok(http.includes("n8n") && http.includes("make") && http.includes("pipedream") && http.includes("serverless"));
  assert.ok(!http.includes("airflow"));
  // native-node: n8n only.
  assert.deepEqual(brokersForTransport("native-node"), ["n8n"]);
});

test("Make, Pipedream, Power Automate and serverless are all synchronous data brokers", () => {
  for (const id of ["make", "pipedream", "power-automate", "serverless", "http-sidecar"]) {
    assert.equal(getBrokerDef(id)?.capabilities.synchronous, true, `${id} should be synchronous`);
  }
});
