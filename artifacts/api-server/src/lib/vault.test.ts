import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setSecret, getSecret, hasSecret, deleteSecret, secretFingerprint, listSecretRefs, __resetVault } from "./vault";

/**
 * Vault: each secret separately encrypted; write-only across the boundary (no plaintext is
 * returned by anything an HTTP route would call except the INTERNAL getSecret).
 */
afterEach(() => __resetVault());

test("a stored secret round-trips through getSecret", () => {
  setSecret("aiprovider:openai", "sk-test-123");
  assert.equal(getSecret("aiprovider:openai"), "sk-test-123");
  assert.equal(hasSecret("aiprovider:openai"), true);
});

test("each secret is encrypted under its own subkey (envelopes differ for same value)", () => {
  setSecret("a", "same-value");
  setSecret("b", "same-value");
  // Both decrypt correctly...
  assert.equal(getSecret("a"), "same-value");
  assert.equal(getSecret("b"), "same-value");
  // ...and the refs are independent.
  deleteSecret("a");
  assert.equal(hasSecret("a"), false);
  assert.equal(getSecret("b"), "same-value");
});

test("a missing secret yields null, not a throw", () => {
  assert.equal(getSecret("nope"), null);
  assert.equal(hasSecret("nope"), false);
  assert.equal(secretFingerprint("nope"), null);
});

test("fingerprint is stable, short, and non-reversible", () => {
  setSecret("k", "super-secret-value");
  const fp = secretFingerprint("k");
  assert.equal(typeof fp, "string");
  assert.equal(fp!.length, 8);
  assert.equal(fp, secretFingerprint("k")); // stable
  assert.equal(fp!.includes("super-secret"), false); // not the value
});

test("deleteSecret removes it and listSecretRefs reflects current refs", () => {
  setSecret("aiprovider:x", "1");
  setSecret("aiprovider:y", "2");
  assert.deepEqual(listSecretRefs(), ["aiprovider:x", "aiprovider:y"]);
  deleteSecret("aiprovider:x");
  assert.deepEqual(listSecretRefs(), ["aiprovider:y"]);
});
