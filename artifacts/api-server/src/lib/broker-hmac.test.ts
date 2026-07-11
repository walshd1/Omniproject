import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signBrokerRequest, verifyBrokerRequest, verifyBrokerRequestShared, __resetBrokerHmac } from "./broker-hmac";

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

// ── Per-session signing key ────────────────────────────────────────────────────
const bindA = { sub: "alice", smono: "1000", salt: "aaaa" };
const bindB = { sub: "bob", smono: "2000", salt: "bbbb" };

test("a session-bound signature verifies under its own binding", () => {
  const body = JSON.stringify({ action: "list_projects" });
  const sig = signBrokerRequest(body, bindA);
  assert.ok(sig.bind, "the binding is echoed for the wire");
  assert.equal(sig.bind?.sub, "alice");
  assert.equal(verifyBrokerRequest({ ...sig, body, bind: sig.bind }), "ok");
});

test("a signature bound to one user does NOT verify under another's binding", () => {
  const body = "x";
  const sig = signBrokerRequest(body, bindA);
  // Same signature, but presented with bob's binding → different key → mismatch.
  assert.equal(verifyBrokerRequest({ ...sig, body, bind: { ...bindB, bkver: sig.bind?.bkver } }), "bad-signature");
});

test("tampering with the transmitted binding breaks verification", () => {
  const body = "x";
  const sig = signBrokerRequest(body, bindA);
  const forged = { ...sig.bind!, salt: "cccc" }; // attacker swaps the salt
  assert.equal(verifyBrokerRequest({ ...sig, body, bind: forged }), "bad-signature");
});

test("a static-key signature does not verify when a binding is asserted (and vice-versa)", () => {
  const body = "x";
  const staticSig = signBrokerRequest(body); // no bind → static key
  assert.equal(verifyBrokerRequest({ ...staticSig, body, bind: bindA }), "bad-signature");
});

// ── Fleet-aware verify (verifyBrokerRequestShared) ───────────────────────────────
// Without REDIS_URL the shared verifier uses the SAME in-process nonce cache as the sync one, so its
// verdicts match verifyBrokerRequest here. The Redis-backed nonce claim (fleet-wide replay across
// broker replicas) only runs when the shared-state seam is Redis-backed (ioredis not installed in
// CI), so it is documented rather than exercised — same posture as the SAML replay-cache tests.
test("shared verify: a fresh signature verifies, a replay is rejected (in-process default)", async () => {
  const body = JSON.stringify({ action: "list_projects" });
  const sig = signBrokerRequest(body);
  assert.equal(await verifyBrokerRequestShared({ ...sig, body }), "ok");
  assert.equal(await verifyBrokerRequestShared({ ...sig, body }), "replay");
});

test("shared verify: signature + freshness are checked before any replay/store step", async () => {
  const sig = signBrokerRequest("original");
  assert.equal(await verifyBrokerRequestShared({ ...sig, body: "tampered" }), "bad-signature");
  const fresh = signBrokerRequest("x");
  assert.equal(await verifyBrokerRequestShared({ ...fresh, body: "x" }, { now: fresh.ts + 10 * 60_000 }), "expired");
});

test("shared verify: shares the replay cache with the sync verifier (a nonce used by one is spent for the other)", async () => {
  const body = "y";
  const sig = signBrokerRequest(body);
  assert.equal(verifyBrokerRequest({ ...sig, body }), "ok");
  assert.equal(await verifyBrokerRequestShared({ ...sig, body }), "replay");
});
