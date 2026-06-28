import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { setSecret, getSecret, hasSecret, deleteSecret, secretFingerprint, listSecretRefs, __resetVault } from "./vault";

/**
 * Vault: each local secret separately encrypted; write-only across the boundary (no plaintext
 * is returned by anything an HTTP route would call except the INTERNAL getSecret). Default
 * backend is the local encrypted file (no VAULT_BACKEND set).
 */
afterEach(() => __resetVault());

test("a stored secret round-trips through getSecret", async () => {
  await setSecret("aiprovider:openai", "sk-test-123");
  assert.equal(getSecret("aiprovider:openai"), "sk-test-123");
  assert.equal(hasSecret("aiprovider:openai"), true);
});

test("secrets are independent (deleting one leaves the other)", async () => {
  await setSecret("a", "same-value");
  await setSecret("b", "same-value");
  assert.equal(getSecret("a"), "same-value");
  assert.equal(getSecret("b"), "same-value");
  await deleteSecret("a");
  assert.equal(hasSecret("a"), false);
  assert.equal(getSecret("b"), "same-value");
});

test("a missing secret yields null, not a throw", () => {
  assert.equal(getSecret("nope"), null);
  assert.equal(hasSecret("nope"), false);
  assert.equal(secretFingerprint("nope"), null);
});

test("fingerprint is stable, short, and non-reversible", async () => {
  await setSecret("k", "super-secret-value");
  const fp = secretFingerprint("k");
  assert.equal(typeof fp, "string");
  assert.equal(fp!.length, 8);
  assert.equal(fp, secretFingerprint("k")); // stable
  assert.equal(fp!.includes("super-secret"), false); // not the value
});

test("deleteSecret removes it and listSecretRefs reflects current refs", async () => {
  await setSecret("aiprovider:x", "1");
  await setSecret("aiprovider:y", "2");
  assert.deepEqual(listSecretRefs(), ["aiprovider:x", "aiprovider:y"]);
  await deleteSecret("aiprovider:x");
  assert.deepEqual(listSecretRefs(), ["aiprovider:y"]);
});
