import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode,
  base32Decode,
  totpCode,
  verifyTotp,
  generateTotpSecret,
  otpauthUrl,
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from "./totp";

// The RFC 6238 test seed: ASCII "12345678901234567890" (20 bytes), whose canonical base32 is well known.
const SEED = Buffer.from("12345678901234567890", "ascii");
const SEED_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("base32 encodes the RFC seed to its canonical value and round-trips", () => {
  assert.equal(base32Encode(SEED), SEED_B32);
  assert.deepEqual(base32Decode(SEED_B32), SEED);
  assert.deepEqual(base32Decode("gezd gnbv"), base32Decode("GEZDGNBV")); // spacing + case tolerated
});

test("totpCode matches the RFC 6238 SHA-1 test vectors (8-digit)", () => {
  // From RFC 6238 Appendix B (SHA1 column), period 30s.
  const vectors = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as const;
  for (const [t, code] of vectors) {
    assert.equal(totpCode(SEED_B32, t, { digits: 8 }), code, `T=${t}`);
    // The 6-digit code is the last 6 digits of the 8-digit one.
    assert.equal(totpCode(SEED_B32, t, { digits: 6 }), code.slice(-6), `T=${t} (6)`);
  }
});

test("verifyTotp accepts the current code and rejects a wrong / stale one", () => {
  const now = 1111111111;
  assert.equal(verifyTotp(SEED_B32, "050471", now, { digits: 6 }), true);
  assert.equal(verifyTotp(SEED_B32, "000000", now, { digits: 6 }), false);
  // A code from ~2 minutes ago is outside the default ±1 step window.
  assert.equal(verifyTotp(SEED_B32, totpCode(SEED_B32, now - 120), now), false);
});

test("verifyTotp tolerates ±1 step of clock skew (the previous/next code)", () => {
  const now = 1111111111;
  assert.equal(verifyTotp(SEED_B32, totpCode(SEED_B32, now - 30), now), true); // previous step
  assert.equal(verifyTotp(SEED_B32, totpCode(SEED_B32, now + 30), now), true); // next step
  // window: 0 accepts only the exact step.
  assert.equal(verifyTotp(SEED_B32, totpCode(SEED_B32, now - 30), now, { window: 0 }), false);
});

test("verifyTotp rejects malformed input up front", () => {
  const now = 1111111111;
  assert.equal(verifyTotp(SEED_B32, "12345", now), false);   // too short
  assert.equal(verifyTotp(SEED_B32, "abcdef", now), false);  // non-digits
  assert.equal(verifyTotp(SEED_B32, "", now), false);
});

test("generateTotpSecret yields a decodable ~160-bit base32 secret each time", () => {
  const a = generateTotpSecret();
  const b = generateTotpSecret();
  assert.notEqual(a, b);
  assert.equal(base32Decode(a).length, 20);
  assert.match(a, /^[A-Z2-7]+$/);
});

test("otpauthUrl builds a scannable provisioning URI", () => {
  const url = otpauthUrl({ secret: SEED_B32, account: "alice@example.com", issuer: "OmniProject" });
  assert.match(url, /^otpauth:\/\/totp\/OmniProject:alice%40example\.com\?/);
  const q = new URL(url).searchParams;
  assert.equal(q.get("secret"), SEED_B32);
  assert.equal(q.get("issuer"), "OmniProject");
  assert.equal(q.get("digits"), "6");
  assert.equal(q.get("period"), "30");
});

test("recovery codes are unique, grouped, and normalise for comparison", () => {
  const codes = generateRecoveryCodes(10);
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0]!, /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  assert.equal(normalizeRecoveryCode("AB1C-DE2F-GH3J-KL4M"), "ab1cde2fgh3jkl4m");
  assert.equal(normalizeRecoveryCode(codes[0]!), codes[0]!.replace(/-/g, ""));
});
