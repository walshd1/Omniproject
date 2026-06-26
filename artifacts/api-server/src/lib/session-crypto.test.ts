import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { seal, open, SEALED_PREFIX } from "./session-crypto";

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
  // Flip a character in the ciphertext region.
  const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
  assert.equal(open(tampered), null);
});

test("open returns null for legacy/plaintext (non-sealed) values", () => {
  process.env["SESSION_SECRET"] = SECRET;
  assert.equal(open('{"sub":"u1"}'), null);
  assert.equal(open(""), null);
  assert.equal(open("v1.not-valid-base64-@@@"), null);
});

test("a different secret cannot open the cookie (key separation)", () => {
  process.env["SESSION_SECRET"] = SECRET;
  const sealed = seal("payload");
  process.env["SESSION_SECRET"] = "a-totally-different-secret-value!!";
  assert.equal(open(sealed), null);
});
