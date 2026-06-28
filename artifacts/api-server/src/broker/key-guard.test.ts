import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { assertKeyedAccess, wrapWithKeyGuard } from "./key-guard";
import { BrokerError, type Broker } from "./types";

/**
 * Keyed-access posture: a live broker call without a configured key (BROKER_PSK) is
 * hard-rejected — except in dev mode.
 */
afterEach(() => {
  delete process.env["BROKER_PSK"];
  delete process.env["OMNI_DEV_MODE"];
  delete process.env["NODE_ENV"];
});

test("no key + not dev ⇒ hard reject", () => {
  delete process.env["BROKER_PSK"];
  assert.throws(() => assertKeyedAccess(), (e) => e instanceof BrokerError && e.code === "unauthorized");
});

test("a configured key passes", () => {
  process.env["BROKER_PSK"] = "a-shared-broker-secret-of-sufficient-length-1234567890";
  assert.doesNotThrow(() => assertKeyedAccess());
});

test("dev mode is the exemption (keyless allowed)", () => {
  delete process.env["BROKER_PSK"];
  process.env["NODE_ENV"] = "development";
  process.env["OMNI_DEV_MODE"] = "1";
  assert.doesNotThrow(() => assertKeyedAccess());
});

test("the guard Proxy rejects keyless broker calls before delegating", () => {
  delete process.env["BROKER_PSK"];
  let reached = false;
  const stub = { listProjects: async () => { reached = true; return []; } } as unknown as Broker;
  const guarded = wrapWithKeyGuard(stub);
  // The guard throws synchronously, before the (async) broker method is invoked.
  assert.throws(() => guarded.listProjects({}), (e) => e instanceof BrokerError);
  assert.equal(reached, false); // never reached the broker
});
