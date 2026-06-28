import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signBrokerRequest, verifyBrokerRequest, __resetBrokerHmac } from "./broker-hmac";

/**
 * Gateway↔broker request HMAC: a fresh signature verifies once; replays, tampering and
 * stale timestamps are refused.
 */
beforeEach(() => __resetBrokerHmac());

test("a fresh signature verifies", () => {
  const body = JSON.stringify({ action: "list_projects" });
  const sig = signBrokerRequest(body);
  assert.equal(verifyBrokerRequest({ ...sig, body }), "ok");
});

test("a replayed nonce is rejected", () => {
  const body = "x";
  const sig = signBrokerRequest(body);
  assert.equal(verifyBrokerRequest({ ...sig, body }), "ok");
  assert.equal(verifyBrokerRequest({ ...sig, body }), "replay");
});

test("a tampered body fails the signature", () => {
  const sig = signBrokerRequest("original");
  assert.equal(verifyBrokerRequest({ ...sig, body: "tampered" }), "bad-signature");
});

test("a stale timestamp is rejected (replay window)", () => {
  const body = "x";
  const sig = signBrokerRequest(body);
  assert.equal(verifyBrokerRequest({ ...sig, body }, { now: sig.ts + 10 * 60_000 }), "expired");
});
