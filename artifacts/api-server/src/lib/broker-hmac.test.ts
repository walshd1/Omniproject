import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { signBrokerRequest, verifyBrokerRequest, verifyBrokerRequestShared, brokerCanonicalString, __resetBrokerHmac, type CanonicalRequest } from "./broker-hmac";

/**
 * Gateway↔broker request HMAC (v2 canonical): a fresh signature verifies once; replays,
 * tampering (body OR routing header), stale timestamps and binding swaps are refused.
 */
beforeEach(() => __resetBrokerHmac());

/** A canonical request with sensible defaults, overridable per-field. */
function req(over: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return { action: "list_projects", source: "pm", idempotencyKey: "idem-1", origin: "omniproject", body: JSON.stringify({ action: "list_projects" }), ...over };
}

test("a fresh signature verifies", () => {
  const r = req();
  const sig = signBrokerRequest(r);
  assert.equal(verifyBrokerRequest({ ...sig, req: r }), "ok");
});

test("a replayed nonce is rejected", () => {
  const r = req({ body: "x" });
  const sig = signBrokerRequest(r);
  assert.equal(verifyBrokerRequest({ ...sig, req: r }), "ok");
  assert.equal(verifyBrokerRequest({ ...sig, req: r }), "replay");
});

test("a tampered body fails the signature", () => {
  const r = req({ body: "original" });
  const sig = signBrokerRequest(r);
  assert.equal(verifyBrokerRequest({ ...sig, req: { ...r, body: "tampered" } }), "bad-signature");
});

test("a swapped routing field (source) fails the signature (F3)", () => {
  const r = req();
  const sig = signBrokerRequest(r);
  // An on-path attacker reroutes the write to a different backend source — must not verify.
  assert.equal(verifyBrokerRequest({ ...sig, req: { ...r, source: "financial_ledger" } }), "bad-signature");
  assert.equal(verifyBrokerRequest({ ...sig, req: { ...r, action: "delete_issue" } }), "bad-signature");
});

test("a stale timestamp is rejected (replay window)", () => {
  const r = req({ body: "x" });
  const sig = signBrokerRequest(r);
  assert.equal(verifyBrokerRequest({ ...sig, req: r }, { now: sig.ts + 10 * 60_000 }), "expired");
});

test("the canonical string is v2-tagged and binds the routing surface", () => {
  const s = brokerCanonicalString(req(), 1234, "nonce-1");
  const lines = s.split("\n");
  assert.equal(lines[0], "v2");
  assert.equal(lines[1], "POST");
  assert.equal(lines[2], "list_projects"); // action
  assert.equal(lines[3], "pm");            // source
});

// ── Per-session signing key ────────────────────────────────────────────────────
const bindA = { sub: "alice", smono: "1000", salt: "aaaa" };
const bindB = { sub: "bob", smono: "2000", salt: "bbbb" };

test("a session-bound signature verifies under its own binding", () => {
  const r = req();
  const sig = signBrokerRequest(r, bindA);
  assert.ok(sig.bind, "the binding is echoed for the wire");
  assert.equal(sig.bind?.sub, "alice");
  assert.equal(verifyBrokerRequest({ ...sig, req: r, bind: sig.bind }), "ok");
});

test("a signature bound to one user does NOT verify under another's binding", () => {
  const r = req({ body: "x" });
  const sig = signBrokerRequest(r, bindA);
  // Same signature, but presented with bob's binding → different key → mismatch.
  assert.equal(verifyBrokerRequest({ ...sig, req: r, bind: { ...bindB, bkver: sig.bind?.bkver } }), "bad-signature");
});

test("tampering with the transmitted binding breaks verification", () => {
  const r = req({ body: "x" });
  const sig = signBrokerRequest(r, bindA);
  const forged = { ...sig.bind!, salt: "cccc" }; // attacker swaps the salt
  assert.equal(verifyBrokerRequest({ ...sig, req: r, bind: forged }), "bad-signature");
});

test("a static-key signature does not verify when a binding is asserted (and vice-versa)", () => {
  const r = req({ body: "x" });
  const staticSig = signBrokerRequest(r); // no bind → static key
  assert.equal(verifyBrokerRequest({ ...staticSig, req: r, bind: bindA }), "bad-signature");
});

// ── Fleet-aware verify (verifyBrokerRequestShared) ───────────────────────────────
// Without REDIS_URL the shared verifier uses the SAME in-process nonce cache as the sync one, so its
// verdicts match verifyBrokerRequest here. The Redis-backed nonce claim (fleet-wide replay across
// broker replicas) only runs when the shared-state seam is Redis-backed (ioredis not installed in
// CI), so it is documented rather than exercised — same posture as the SAML replay-cache tests.
test("shared verify: a fresh signature verifies, a replay is rejected (in-process default)", async () => {
  const r = req();
  const sig = signBrokerRequest(r);
  assert.equal(await verifyBrokerRequestShared({ ...sig, req: r }), "ok");
  assert.equal(await verifyBrokerRequestShared({ ...sig, req: r }), "replay");
});

test("shared verify: signature + freshness are checked before any replay/store step", async () => {
  const r = req({ body: "original" });
  const sig = signBrokerRequest(r);
  assert.equal(await verifyBrokerRequestShared({ ...sig, req: { ...r, body: "tampered" } }), "bad-signature");
  const fr = req({ body: "x" });
  const fresh = signBrokerRequest(fr);
  assert.equal(await verifyBrokerRequestShared({ ...fresh, req: fr }, { now: fresh.ts + 10 * 60_000 }), "expired");
});

test("shared verify: shares the replay cache with the sync verifier (a nonce used by one is spent for the other)", async () => {
  const r = req({ body: "y" });
  const sig = signBrokerRequest(r);
  assert.equal(verifyBrokerRequest({ ...sig, req: r }), "ok");
  assert.equal(await verifyBrokerRequestShared({ ...sig, req: r }), "replay");
});
