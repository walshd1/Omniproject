import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

/**
 * Unit tests for the dependency-free JWKS / JWT verifier (lib/jwks). We mint
 * real RS256 and ES256 tokens with freshly generated key pairs and verify them
 * against the public JWK, plus exercise the claim validation and the cached
 * JWKS fetch (with an injected fetch impl — no real network).
 */
const {
  parseJwt,
  verifySignatureWithJwk,
  validateClaims,
  fetchJwks,
  verifyIdToken,
} = await import("../lib/jwks");

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

/** Mint a compact JWS over the given header/claims with a private key. */
function mintRs256(claims: object, privateKey: crypto.KeyObject, kid = "k1"): string {
  const header = { alg: "RS256", typ: "JWT", kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = crypto.sign("sha256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${sig}`;
}

function mintEs256(claims: object, privateKey: crypto.KeyObject, kid = "ec1"): string {
  const header = { alg: "ES256", typ: "JWT", kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = crypto
    .sign("sha256", Buffer.from(signingInput), { key: privateKey, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${signingInput}.${sig}`;
}

const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const rsaJwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };

const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const ecJwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "ec1", use: "sig", alg: "ES256" };

test("parseJwt splits and decodes a compact JWS", () => {
  const token = mintRs256({ sub: "abc", iss: "https://idp" }, rsa.privateKey);
  const parsed = parseJwt(token);
  assert.equal(parsed.header.alg, "RS256");
  assert.equal(parsed.header.kid, "k1");
  assert.equal(parsed.claims.sub, "abc");
  assert.equal(parsed.claims.iss, "https://idp");
});

test("parseJwt throws on the wrong number of segments", () => {
  assert.throws(() => parseJwt("a.b"), /Malformed JWT/);
});

test("parseJwt throws when the header has no alg", () => {
  const token = `${b64url({ typ: "JWT" })}.${b64url({ sub: "x" })}.sig`;
  assert.throws(() => parseJwt(token), /missing alg/);
});

test("verifySignatureWithJwk verifies a genuine RS256 signature", () => {
  const parsed = parseJwt(mintRs256({ sub: "rsa-user" }, rsa.privateKey));
  assert.equal(verifySignatureWithJwk(parsed, rsaJwk as never), true);
});

test("verifySignatureWithJwk verifies a genuine ES256 signature", () => {
  const parsed = parseJwt(mintEs256({ sub: "ec-user" }, ec.privateKey));
  assert.equal(verifySignatureWithJwk(parsed, ecJwk as never), true);
});

test("verifySignatureWithJwk returns false for a tampered token", () => {
  const token = mintRs256({ sub: "rsa-user" }, rsa.privateKey);
  // Flip a payload byte so the signature no longer matches.
  const parts = token.split(".");
  const tampered = parseJwt(`${parts[0]}.${b64url({ sub: "attacker" })}.${parts[2]}`);
  assert.equal(verifySignatureWithJwk(tampered, rsaJwk as never), false);
});

test("verifySignatureWithJwk rejects a disallowed alg", () => {
  const bad = { header: { alg: "HS256" }, claims: {}, signingInput: "x", signature: Buffer.alloc(0) };
  assert.throws(() => verifySignatureWithJwk(bad as never, rsaJwk as never), /Unsupported JWT alg/);
});

test("validateClaims passes for matching iss/aud and unexpired token", () => {
  const now = 1_000_000;
  const reason = validateClaims(
    { iss: "https://idp", aud: "client-1", exp: now + 100 },
    { issuer: "https://idp", audience: "client-1", now },
  );
  assert.equal(reason, null);
});

test("validateClaims reports issuer / audience / expiry / nbf failures", () => {
  const now = 1_000_000;
  assert.match(
    validateClaims({ iss: "https://evil", aud: "c" }, { issuer: "https://idp", audience: "c", now })!,
    /issuer mismatch/,
  );
  assert.match(
    validateClaims({ iss: "https://idp", aud: "other" }, { issuer: "https://idp", audience: "c", now })!,
    /audience mismatch/,
  );
  assert.match(
    validateClaims({ iss: "https://idp", aud: "c", exp: now - 1000 }, { issuer: "https://idp", audience: "c", now })!,
    /expired/,
  );
  assert.match(
    validateClaims({ iss: "https://idp", aud: "c", nbf: now + 1000 }, { issuer: "https://idp", audience: "c", now })!,
    /not yet valid/,
  );
});

test("validateClaims accepts an audience array containing the expected value", () => {
  const reason = validateClaims(
    { iss: "https://idp", aud: ["other", "client-1"] },
    { issuer: "https://idp", audience: "client-1", now: 0 },
  );
  assert.equal(reason, null);
});

test("fetchJwks fetches, caches, and selects keys by kid", async () => {
  let hits = 0;
  const uniqueUri = `https://idp.test/jwks-${crypto.randomUUID()}`;
  const fakeFetch = (async () => {
    hits++;
    return new Response(JSON.stringify({ keys: [rsaJwk, ecJwk] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const keys1 = await fetchJwks(uniqueUri, fakeFetch);
  assert.equal(keys1.length, 2);
  // Second call hits the in-memory cache (TTL 10m), so fetch isn't re-invoked.
  const keys2 = await fetchJwks(uniqueUri, fakeFetch);
  assert.equal(keys2.length, 2);
  assert.equal(hits, 1);
});

test("fetchJwks throws on a non-ok response", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  await assert.rejects(
    () => fetchJwks(`https://idp.test/jwks-${crypto.randomUUID()}`, fakeFetch),
    /JWKS fetch failed \(500\)/,
  );
});

test("verifyIdToken end-to-end verifies signature + claims via injected fetch", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = mintRs256(
    { sub: "u1", iss: "https://idp", aud: "client-1", exp: now + 3600 },
    rsa.privateKey,
  );
  const uri = `https://idp.test/jwks-${crypto.randomUUID()}`;
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ keys: [rsaJwk] }), { status: 200 })) as typeof fetch;

  const claims = await verifyIdToken(token, {
    jwksUri: uri,
    issuer: "https://idp",
    audience: "client-1",
    fetchImpl: fakeFetch,
  });
  assert.equal(claims.sub, "u1");
});

test("verifyIdToken throws when no JWKS key matches", async () => {
  const token = mintRs256({ sub: "u1", iss: "https://idp", aud: "client-1" }, rsa.privateKey, "missing-kid");
  const uri = `https://idp.test/jwks-${crypto.randomUUID()}`;
  // Return a key with a different kid AND use:"enc" so selectKeys yields nothing.
  const otherKey = { ...ecJwk, kid: "other", use: "enc" };
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ keys: [otherKey] }), { status: 200 })) as typeof fetch;

  await assert.rejects(
    () => verifyIdToken(token, { jwksUri: uri, issuer: "https://idp", audience: "client-1", fetchImpl: fakeFetch }),
    /No matching JWKS key/,
  );
});

test("verifyIdToken throws on claim mismatch even with a valid signature", async () => {
  const token = mintRs256({ sub: "u1", iss: "https://other", aud: "client-1" }, rsa.privateKey);
  const uri = `https://idp.test/jwks-${crypto.randomUUID()}`;
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ keys: [rsaJwk] }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => verifyIdToken(token, { jwksUri: uri, issuer: "https://idp", audience: "client-1", fetchImpl: fakeFetch }),
    /claim validation failed/,
  );
});
