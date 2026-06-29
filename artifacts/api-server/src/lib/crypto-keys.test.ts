import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { deriveKey, deriveKeyCached, decodeKey32, fingerprint } from "./crypto-keys";

test("deriveKey is HKDF-SHA256, 32 bytes, stable per (secret, info), domain-separated", () => {
  const k = deriveKey("a-secret", "domain-a");
  assert.equal(k.length, 32);
  // Matches Node's HKDF with the module's fixed salt + the given info label.
  const expected = Buffer.from(
    crypto.hkdfSync("sha256", "a-secret", Buffer.from("omniproject/hkdf/v1"), "domain-a", 32),
  );
  assert.deepEqual(k, expected);
  assert.equal(deriveKey("a-secret", "domain-a"), deriveKey("a-secret", "domain-a")); // cached
  // Same secret, different info → independent keys (domain separation).
  assert.notDeepEqual(deriveKey("a-secret", "domain-b"), k);
  // HKDF differs from the legacy SHA-256 derivation.
  assert.notDeepEqual(deriveKey("a-secret", "domain-a"), deriveKeyCached("a-secret"));
});

test("deriveKeyCached returns a 32-byte sha256 key and is stable per secret", () => {
  const k = deriveKeyCached("a-secret");
  assert.equal(k.length, 32);
  assert.deepEqual(k, crypto.createHash("sha256").update("a-secret").digest());
  assert.equal(deriveKeyCached("a-secret"), deriveKeyCached("a-secret")); // cached (same Buffer)
  assert.notDeepEqual(deriveKeyCached("other"), k);
});

test("decodeKey32 accepts exactly 32 bytes, else null", () => {
  const key = crypto.randomBytes(32).toString("base64");
  assert.equal(decodeKey32(key)?.length, 32);
  assert.equal(decodeKey32(crypto.randomBytes(16).toString("base64")), null);
  assert.equal(decodeKey32("not-base64-but-short"), null);
});

test("fingerprint is a truncated sha256 hex, default 12 chars", () => {
  assert.equal(fingerprint("x"), crypto.createHash("sha256").update("x").digest("hex").slice(0, 12));
  assert.equal(fingerprint("x").length, 12);
  assert.equal(fingerprint("x", 8).length, 8);
  assert.notEqual(fingerprint("a"), fingerprint("b"));
});
