import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

/**
 * Tests for the JWKS / ID-token verifier (lib/jwks). The cryptographic
 * verification is delegated to `jose`; these mint real RS256 and ES256 tokens
 * with freshly generated key pairs and drive them through the `verifyIdToken`
 * seam (with an injected fetch impl — no real network), plus exercise the pure
 * `parseJwt` / `validateClaims` helpers and the SSRF-guarded `fetchJwks` cache.
 */
const {
  parseJwt,
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

test("validateClaims passes (does not throw) for matching iss/aud and unexpired token", () => {
  const now = 1_000_000;
  assert.doesNotThrow(() => validateClaims(
    { iss: "https://idp", aud: "client-1", exp: now + 100 },
    { issuer: "https://idp", audience: "client-1", now },
  ));
});

test("validateClaims throws reporting issuer / audience / expiry / nbf failures", () => {
  const now = 1_000_000;
  assert.throws(
    () => validateClaims({ iss: "https://evil", aud: "c" }, { issuer: "https://idp", audience: "c", now }),
    /issuer mismatch/,
  );
  assert.throws(
    () => validateClaims({ iss: "https://idp", aud: "other" }, { issuer: "https://idp", audience: "c", now }),
    /audience mismatch/,
  );
  assert.throws(
    () => validateClaims({ iss: "https://idp", aud: "c", exp: now - 1000 }, { issuer: "https://idp", audience: "c", now }),
    /expired/,
  );
  assert.throws(
    () => validateClaims({ iss: "https://idp", aud: "c", nbf: now + 1000 }, { issuer: "https://idp", audience: "c", now }),
    /not yet valid/,
  );
});

test("validateClaims accepts an audience array containing the expected value", () => {
  assert.doesNotThrow(() => validateClaims(
    { iss: "https://idp", aud: ["other", "client-1"] },
    { issuer: "https://idp", audience: "client-1", now: 0 },
  ));
});

test("fetchJwks fetches, caches, and returns the keys", async () => {
  let hits = 0;
  const uniqueUri = `http://127.0.0.1/jwks-${crypto.randomUUID()}`;
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

test("fetchJwks blocks a metadata/link-local jwks_uri before fetching (SSRF guard)", async () => {
  let called = false;
  const fakeFetch = (async () => { called = true; return new Response("{}", { status: 200 }); }) as typeof fetch;
  await assert.rejects(() => fetchJwks("http://169.254.169.254/jwks", fakeFetch));
  assert.equal(called, false); // the egress guard runs before any fetch
});

test("fetchJwks throws on a non-ok response", async () => {
  const fakeFetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  await assert.rejects(
    () => fetchJwks(`http://127.0.0.1/jwks-${crypto.randomUUID()}`, fakeFetch),
    /JWKS fetch failed \(500\)/,
  );
});

test("verifyIdToken end-to-end verifies an RS256 signature + claims via injected fetch", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = mintRs256(
    { sub: "u1", iss: "https://idp", aud: "client-1", exp: now + 3600 },
    rsa.privateKey,
  );
  const uri = `http://127.0.0.1/jwks-${crypto.randomUUID()}`;
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

test("verifyIdToken end-to-end verifies an ES256 signature", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = mintEs256({ sub: "ec-user", iss: "https://idp", aud: "client-1", exp: now + 3600 }, ec.privateKey);
  const uri = `http://127.0.0.1/jwks-${crypto.randomUUID()}`;
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ keys: [ecJwk] }), { status: 200 })) as typeof fetch;
  const claims = await verifyIdToken(token, { jwksUri: uri, issuer: "https://idp", audience: "client-1", fetchImpl: fakeFetch });
  assert.equal(claims.sub, "ec-user");
});

test("verifyIdToken throws when no JWKS key matches", async () => {
  const token = mintRs256({ sub: "u1", iss: "https://idp", aud: "client-1" }, rsa.privateKey, "missing-kid");
  const uri = `http://127.0.0.1/jwks-${crypto.randomUUID()}`;
  const otherKey = { ...ecJwk, kid: "other" };
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ keys: [otherKey] }), { status: 200 })) as typeof fetch;

  await assert.rejects(
    () => verifyIdToken(token, { jwksUri: uri, issuer: "https://idp", audience: "client-1", fetchImpl: fakeFetch }),
    /verification failed|key/i,
  );
});

test("verifyIdToken throws on claim mismatch even with a valid signature", async () => {
  const token = mintRs256({ sub: "u1", iss: "https://other", aud: "client-1", exp: Math.floor(Date.now() / 1000) + 600 }, rsa.privateKey);
  const uri = `http://127.0.0.1/jwks-${crypto.randomUUID()}`;
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ keys: [rsaJwk] }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => verifyIdToken(token, { jwksUri: uri, issuer: "https://idp", audience: "client-1", fetchImpl: fakeFetch }),
    /verification failed|iss|claim/i,
  );
});

test("verifyIdToken rejects an HS256 alg-confusion token (asymmetric-only allowlist)", async () => {
  // Forge an HS256 token using the RSA public key as the HMAC secret.
  const pubPem = rsa.publicKey.export({ format: "pem", type: "spki" }) as string;
  const header = b64url({ alg: "HS256", typ: "JWT", kid: "k1" });
  const body = b64url({ sub: "attacker", iss: "https://idp", aud: "client-1" });
  const sig = crypto.createHmac("sha256", pubPem).update(`${header}.${body}`).digest("base64url");
  const forged = `${header}.${body}.${sig}`;
  const uri = `http://127.0.0.1/jwks-${crypto.randomUUID()}`;
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ keys: [rsaJwk] }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => verifyIdToken(forged, { jwksUri: uri, issuer: "https://idp", audience: "client-1", fetchImpl: fakeFetch }),
  );
});
