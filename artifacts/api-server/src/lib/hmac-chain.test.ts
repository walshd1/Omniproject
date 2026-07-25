import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { chainLinkHash, verifyChainLink, attachAnchorSignature, verifyAnchorSignature } from "./hmac-chain";

/**
 * The shared keyed hash-chain primitives (lib/hmac-chain) used by the audit chain, the provenance ring
 * and the OmniStore log. These tests LOCK the on-disk wire format (so existing sealed logs still verify
 * after the extraction) and the constant-time verify.
 */

const KEY = "unit-test-chain-key";

test("chainLinkHash matches the exact 'seq|prevHash|body' HMAC-SHA256 wire format", () => {
  const body = '{"a":1}';
  const expected = createHmac("sha256", KEY).update(`7|abc123|${body}`).digest("hex");
  assert.equal(chainLinkHash(KEY, 7, "abc123", body), expected);
});

test("chainLinkHash is deterministic and sensitive to every component", () => {
  const h = chainLinkHash(KEY, 1, "p", "b");
  assert.equal(chainLinkHash(KEY, 1, "p", "b"), h);          // stable
  assert.notEqual(chainLinkHash(KEY, 2, "p", "b"), h);       // seq
  assert.notEqual(chainLinkHash(KEY, 1, "q", "b"), h);       // prevHash
  assert.notEqual(chainLinkHash(KEY, 1, "p", "c"), h);       // body
  assert.notEqual(chainLinkHash("other-key", 1, "p", "b"), h); // key
});

test("chainLinkHash accepts both string and Buffer keys (audit uses string, omnistore uses Buffer)", () => {
  const asString = chainLinkHash("k", 1, "p", "b");
  const asBuffer = chainLinkHash(Buffer.from("k"), 1, "p", "b");
  assert.equal(asString, asBuffer);
});

test("verifyChainLink accepts the true hash and rejects any tamper", () => {
  const good = chainLinkHash(KEY, 3, "prev", "body");
  assert.equal(verifyChainLink(KEY, 3, "prev", "body", good), true);
  assert.equal(verifyChainLink(KEY, 3, "prev", "body", good.replace(/.$/, "0")), false); // altered hash
  assert.equal(verifyChainLink(KEY, 4, "prev", "body", good), false);                    // altered seq
  assert.equal(verifyChainLink("wrong-key", 3, "prev", "body", good), false);            // wrong key
});

test("verifyChainLink is length-safe against a malformed claimed hash", () => {
  const good = chainLinkHash(KEY, 1, "p", "b");
  assert.equal(verifyChainLink(KEY, 1, "p", "b", ""), false);
  assert.equal(verifyChainLink(KEY, 1, "p", "b", good + "extra"), false);
});

test("attachAnchorSignature leaves the base unsigned when no signing key is configured", () => {
  // Default unit env has no SIGNING_PRIVATE_KEY, so signMessage returns null and the anchor is returned as-is.
  const base = { seq: 5, lastHash: "tip", algorithm: "HMAC-SHA256/chain", keyVersion: 1 };
  const anchor = attachAnchorSignature(base, "msg");
  assert.deepEqual(anchor, base);
  assert.equal("signature" in anchor, false);
});

test("verifyAnchorSignature is false for an unsigned anchor", () => {
  assert.equal(verifyAnchorSignature(undefined, "msg", "-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----"), false);
});
