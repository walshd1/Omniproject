import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { webhookPool, orderedTargets } from ".";

afterEach(() => {
  delete process.env["BROKER_URLS"];
  delete process.env["N8N_WEBHOOK_URL"];
});

test("webhookPool: BROKER_URLS yields a multi-instance pool (trimmed)", () => {
  process.env["BROKER_URLS"] = "http://n1/webhook, http://n2/webhook ,http://n3/webhook";
  assert.deepEqual(webhookPool(), ["http://n1/webhook", "http://n2/webhook", "http://n3/webhook"]);
});

test("webhookPool: a single instance when BROKER_URLS is unset", () => {
  delete process.env["BROKER_URLS"];
  assert.equal(webhookPool().length, 1);
});

test("webhookPool: falls back to the deprecated N8N_WEBHOOK_URL alias", () => {
  // BROKER_URL is the current name; N8N_WEBHOOK_URL is honoured for backwards
  // compatibility when it's the only one set (and no settings override exists).
  delete process.env["BROKER_URLS"];
  process.env["N8N_WEBHOOK_URL"] = "http://legacy:5678/webhook/omniproject";
  assert.deepEqual(webhookPool(), ["http://legacy:5678/webhook/omniproject"]);
});

test("orderedTargets: round-robins across the pool, covering every instance", () => {
  process.env["BROKER_URLS"] = "http://a,http://b,http://c";
  // Three consecutive calls start at three different instances (load spread).
  const firsts = new Set<string>();
  for (let i = 0; i < 3; i++) firsts.add(orderedTargets()[0]!);
  assert.deepEqual([...firsts].sort(), ["http://a", "http://b", "http://c"]);
  // Every ordering is a full rotation — failover can reach any instance.
  assert.deepEqual([...orderedTargets()].sort(), ["http://a", "http://b", "http://c"]);
});
