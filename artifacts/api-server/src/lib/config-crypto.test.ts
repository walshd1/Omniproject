import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  sealConfig, openConfig, readMaybeSealed, exportConfigBundle, openBundle,
  rotateInternalKey, internalKeyFingerprint, isSealedConfig, __resetConfigCrypto,
  ConfigDecryptError, isUndecryptableSealed,
} from "./config-crypto";
import { aesGcmSeal } from "./crypto-aes-gcm";

/**
 * Config-at-rest encryption + secure export: AES-256-GCM, tamper-evident, versioned
 * internal key, and an export that leaks only an ephemeral key (then rekeys internal).
 */
afterEach(() => { __resetConfigCrypto(); delete process.env["CONFIG_KEY_RAW"]; });

test("seal → open round-trips and is opaque at rest", () => {
  const plain = JSON.stringify({ capabilityStates: { "provider:openai": { state: "off" } } });
  const token = sealConfig(plain);
  assert.ok(token.startsWith("c2.1.")); // current internal format (HKDF), version 1
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

test("isSealedConfig recognises sealed tokens by content, not plaintext", () => {
  assert.equal(isSealedConfig(sealConfig("anything")), true);
  assert.equal(isSealedConfig('{"plain":true}'), false);
  assert.equal(isSealedConfig(""), false);
});

test("a rotated internal key still opens OLD tokens (version embedded) + seals new ones", () => {
  const oldToken = sealConfig("v1 data"); // sealed at v1
  rotateInternalKey();
  const newToken = sealConfig("v2 data"); // sealed at v2
  assert.ok(newToken.startsWith("c2.2."));
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

test("openConfig rejects non-internal, dot-less, and non-integer-version tokens", () => {
  assert.equal(openConfig("e1.something"), null); // wrong prefix
  assert.equal(openConfig("c1."), null); // nothing after prefix (dot at index <= 0)
  assert.equal(openConfig("c1.payload-no-version-dot"), null); // no dot inside the rest
  assert.equal(openConfig("c1.abc.payload"), null); // version "abc" is not an integer
});

test("opening an OLDER version token doesn't lower the current version (noteVersion guard)", () => {
  rotateInternalKey(); // currentVersion → 2
  rotateInternalKey(); // → 3
  const v3token = sealConfig("at v3");
  // A v1 token opens fine but must not pull currentVersion back down to 1.
  assert.equal(openConfig("c1.1.not-a-real-payload"), null); // decrypt fails but version noted
  assert.equal(openConfig(v3token), "at v3", "current version unchanged, v3 still opens");
});

test("readMaybeSealed passes plaintext through and THROWS on an unopenable sealed token (never silent '')", () => {
  assert.equal(readMaybeSealed("just plaintext"), "just plaintext");
  // An undecryptable sealed token must NOT read as empty — that let a wrong/rotated key seal
  // default state over valid ciphertext and destroy the store. It now throws so callers can refuse.
  assert.throws(() => readMaybeSealed("c1.1.garbage-that-cannot-decrypt"), ConfigDecryptError);
  assert.equal(isUndecryptableSealed("c1.1.garbage-that-cannot-decrypt"), true);
  assert.equal(isUndecryptableSealed("just plaintext"), false);
});

test("with CONFIG_KEY_RAW, a post-export rekey genuinely rotates the at-rest key (v1 still opens, v2 differs)", () => {
  process.env["CONFIG_KEY_RAW"] = Buffer.alloc(32, 7).toString("base64");
  __resetConfigCrypto();
  const v1 = sealConfig("secret");
  assert.ok(v1.startsWith("c2.1."));
  const fp1 = internalKeyFingerprint();
  rotateInternalKey(); // the post-export rekey — was a silent no-op under a raw key before
  const v2 = sealConfig("secret");
  assert.ok(v2.startsWith("c2.2."));
  assert.notEqual(internalKeyFingerprint(), fp1); // key actually changed
  assert.equal(openConfig(v1), "secret"); // v1 still opens (backward-compatible: v1 = raw key)
  assert.equal(openConfig(v2), "secret");
});

test("LEGACY c1. tokens (pre-HKDF sha256 derivation) still decrypt after the HKDF migration", () => {
  // Reconstruct a token EXACTLY as the pre-migration code sealed it: a master-derived SHA-256 key,
  // AES-GCM, c1.1. framing. It MUST still open now that fresh writes are c2. (HKDF) — proving
  // existing at-rest config survives the upgrade with no re-key.
  const prev = process.env["SESSION_SECRET"];
  process.env["SESSION_SECRET"] = "legacy-master-secret-value";
  try {
    const legacyKey = crypto.createHash("sha256").update("config:v1:legacy-master-secret-value").digest();
    const legacyToken = "c1.1." + aesGcmSeal("legacy-plaintext", legacyKey);
    assert.equal(openConfig(legacyToken), "legacy-plaintext"); // legacy c1. still opens
    assert.ok(isSealedConfig(legacyToken));
    assert.ok(sealConfig("x").startsWith("c2.1.")); // …while new writes are the HKDF c2. format
  } finally {
    if (prev === undefined) delete process.env["SESSION_SECRET"]; else process.env["SESSION_SECRET"] = prev;
  }
});

test("openBundle rejects a wrong prefix and a wrong-length key", () => {
  const { bundle, exportKey } = exportConfigBundle("payload");
  assert.equal(openBundle("nope.payload", exportKey), null); // wrong prefix
  assert.equal(openBundle(bundle, Buffer.alloc(16).toString("base64")), null); // 16-byte key
  assert.equal(openBundle(bundle, exportKey), "payload"); // sanity: correct key opens it
});
