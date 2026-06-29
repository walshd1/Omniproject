import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { seal, open, SEALED_PREFIX } from "./session-crypto";
import { aesGcmSeal } from "./crypto-aes-gcm";
import { deriveKeyCached } from "./crypto-keys";

const SECRET = "a-strong-test-session-secret-value";

afterEach(() => { delete process.env["SESSION_SECRET"]; });

test("seal/open round-trips and never leaks the plaintext", () => {
  process.env["SESSION_SECRET"] = SECRET;
  const payload = JSON.stringify({ sub: "u1", email: "a@b.c", token: "super-secret-bearer" });
  const sealed = seal(payload);
  assert.ok(sealed.startsWith(SEALED_PREFIX));
  assert.ok(!sealed.includes("super-secret-bearer"), "ciphertext must not contain the token");
  assert.equal(open(sealed), payload);
});

test("open returns null on tampering (GCM auth tag fails)", () => {
  process.env["SESSION_SECRET"] = SECRET;
  const sealed = seal("hello");
  // Corrupt a character in the middle of the base64 body (well clear of any
  // trailing padding), guaranteeing it actually CHANGES — flip it to a different
  // character than whatever is there. (The old logic checked the last char but
  // replaced the second-to-last, so when that char was already "A" the "tamper"
  // was a no-op and open() round-tripped — a ~1/64 flake.)
  const i = Math.floor(sealed.length / 2);
  const replacement = sealed[i] === "A" ? "B" : "A";
  const tampered = sealed.slice(0, i) + replacement + sealed.slice(i + 1);
  assert.notEqual(tampered, sealed, "the tamper must actually change the ciphertext");
  assert.equal(open(tampered), null);
});

test("open returns null for legacy/plaintext (non-sealed) values", () => {
  process.env["SESSION_SECRET"] = SECRET;
  assert.equal(open('{"sub":"u1"}'), null);
  assert.equal(open(""), null);
  assert.equal(open("v1.not-valid-base64-@@@"), null);
});

test("new cookies are sealed under the v2 (HKDF) prefix", () => {
  process.env["SESSION_SECRET"] = SECRET;
  assert.ok(seal("x").startsWith("v2."));
});

test("legacy v1 (SHA-256) cookies still open after the HKDF migration", () => {
  process.env["SESSION_SECRET"] = SECRET;
  // Reproduce how a pre-HKDF release sealed: legacy key + "v1." prefix.
  const payload = JSON.stringify({ sub: "u1" });
  const legacy = "v1." + aesGcmSeal(payload, deriveKeyCached(SECRET));
  assert.equal(open(legacy), payload);
});

test("a different secret cannot open the cookie (key separation)", () => {
  process.env["SESSION_SECRET"] = SECRET;
  const sealed = seal("payload");
  process.env["SESSION_SECRET"] = "a-totally-different-secret-value!!";
  assert.equal(open(sealed), null);
});
