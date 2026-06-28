import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sealConfig, openConfig, readMaybeSealed, exportConfigKey, configKeyFingerprint } from "./config-crypto";

/**
 * Config-at-rest encryption: AES-256-GCM round-trip, tamper-evident, and an exported key
 * that decrypts files moved to another deployment (set as CONFIG_KEY_RAW there).
 */
afterEach(() => { delete process.env["CONFIG_KEY_RAW"]; delete process.env["CONFIG_KEY"]; });

test("seal → open round-trips", () => {
  const plain = JSON.stringify({ capabilityStates: { "provider:openai": { state: "off" } } });
  const token = sealConfig(plain);
  assert.ok(token.startsWith("c1."));
  assert.ok(!/provider:openai/.test(token)); // opaque at rest
  assert.equal(openConfig(token), plain);
});

test("a tampered token fails authentication (returns null)", () => {
  const token = sealConfig("secret config");
  const tampered = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");
  assert.equal(openConfig(tampered), null);
});

test("readMaybeSealed opens sealed text and passes plaintext through (migration)", () => {
  assert.equal(readMaybeSealed(sealConfig("hello")), "hello");
  assert.equal(readMaybeSealed('{"plain":true}'), '{"plain":true}');
});

test("a non-token is not opened", () => {
  assert.equal(openConfig("not-a-token"), null);
});

test("an exported raw key set as CONFIG_KEY_RAW decrypts files from another deployment", () => {
  // Deployment A seals with its derived key.
  const token = sealConfig("moved config");
  const exported = exportConfigKey();
  const fpA = configKeyFingerprint();
  // Deployment B is told to use the exported raw key — it now opens A's file.
  process.env["CONFIG_KEY_RAW"] = exported;
  assert.equal(configKeyFingerprint(), fpA); // same key ⇒ same fingerprint
  assert.equal(openConfig(token), "moved config");
});

test("the fingerprint is non-secret and stable for a key", () => {
  assert.equal(configKeyFingerprint().length, 12);
  assert.equal(configKeyFingerprint(), configKeyFingerprint());
});
