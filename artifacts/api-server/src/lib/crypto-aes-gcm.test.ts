import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";

/** The shared AES-256-GCM primitive used by config-crypto, session-crypto, broker-psk, vault. */
const key = () => crypto.createHash("sha256").update("test-key").digest();

test("seal → open round-trips a string", () => {
  const k = key();
  assert.equal(aesGcmOpen(aesGcmSeal("hello, world", k), k), "hello, world");
});

test("each seal is unique (random IV) but both open", () => {
  const k = key();
  const a = aesGcmSeal("x", k), b = aesGcmSeal("x", k);
  assert.notEqual(a, b);
  assert.equal(aesGcmOpen(a, k), "x");
  assert.equal(aesGcmOpen(b, k), "x");
});

test("a wrong key returns null (never throws)", () => {
  const sealed = aesGcmSeal("secret", key());
  assert.equal(aesGcmOpen(sealed, crypto.createHash("sha256").update("other").digest()), null);
});

test("tampered ciphertext fails the auth tag → null", () => {
  const k = key();
  const sealed = aesGcmSeal("secret", k);
  const buf = Buffer.from(sealed, "base64url");
  buf[buf.length - 1]! ^= 0xff; // flip a ciphertext bit (sealed buffer is non-empty)
  assert.equal(aesGcmOpen(buf.toString("base64url"), k), null);
});

test("malformed / too-short input returns null", () => {
  const k = key();
  assert.equal(aesGcmOpen("", k), null);
  assert.equal(aesGcmOpen("not base64url!!", k), null);
  assert.equal(aesGcmOpen(Buffer.alloc(10).toString("base64url"), k), null); // < iv+tag
});

test("the wire format is base64url(iv[12] | tag[16] | ct) — stable for at-rest data", () => {
  const k = key();
  const raw = Buffer.from(aesGcmSeal("abc", k), "base64url");
  assert.equal(raw.length, 12 + 16 + 3); // iv + tag + 3 plaintext bytes (GCM is not padded)
});
