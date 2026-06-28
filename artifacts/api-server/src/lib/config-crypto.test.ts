import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  sealConfig, openConfig, readMaybeSealed, exportConfigBundle, openBundle,
  rotateInternalKey, internalKeyFingerprint, __resetConfigCrypto,
} from "./config-crypto";

/**
 * Config-at-rest encryption + secure export: AES-256-GCM, tamper-evident, versioned
 * internal key, and an export that leaks only an ephemeral key (then rekeys internal).
 */
afterEach(() => { __resetConfigCrypto(); delete process.env["CONFIG_KEY_RAW"]; });

test("seal → open round-trips and is opaque at rest", () => {
  const plain = JSON.stringify({ capabilityStates: { "provider:openai": { state: "off" } } });
  const token = sealConfig(plain);
  assert.ok(token.startsWith("c1.1.")); // internal format, version 1
  assert.ok(!/provider:openai/.test(token));
  assert.equal(openConfig(token), plain);
});

test("a tampered token fails authentication (returns null)", () => {
  const token = sealConfig("secret config");
  assert.equal(openConfig(token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA")), null);
});

test("readMaybeSealed opens sealed text and passes plaintext through (migration)", () => {
  assert.equal(readMaybeSealed(sealConfig("hello")), "hello");
  assert.equal(readMaybeSealed('{"plain":true}'), '{"plain":true}');
});

test("a rotated internal key still opens OLD tokens (version embedded) + seals new ones", () => {
  const oldToken = sealConfig("v1 data"); // sealed at v1
  rotateInternalKey();
  const newToken = sealConfig("v2 data"); // sealed at v2
  assert.ok(newToken.startsWith("c1.2."));
  assert.equal(openConfig(oldToken), "v1 data"); // old still readable
  assert.equal(openConfig(newToken), "v2 data");
});

test("EXPORT: the internal key never leaves; only an ephemeral key decrypts the bundle", () => {
  const config = JSON.stringify({ environments: { prod: {} }, versions: [] });
  const fpBefore = internalKeyFingerprint();
  const out = exportConfigBundle(config);

  // The bundle is ephemeral-format and opens ONLY with the exported key.
  assert.ok(out.bundle.startsWith("e1."));
  assert.equal(openBundle(out.bundle, out.exportKey), config);
  assert.equal(openConfig(out.bundle), null); // not the internal format
  assert.equal(openBundle(out.bundle, Buffer.alloc(32).toString("base64")), null); // wrong key

  // Internal key was REKEYED by the export (forward secrecy for the live store).
  assert.equal(out.toVersion, out.fromVersion + 1);
  assert.notEqual(internalKeyFingerprint(), fpBefore);
});

test("CONFIG_KEY_RAW is used directly (restore a specific key on a target)", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  process.env["CONFIG_KEY_RAW"] = key;
  const token = sealConfig("restored");
  __resetConfigCrypto(); // simulate a fresh process with the same CONFIG_KEY_RAW
  assert.equal(openConfig(token), "restored");
});
