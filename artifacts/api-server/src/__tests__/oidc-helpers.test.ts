import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

/**
 * Unit tests for the OIDC relying-party helpers (lib/oidc). These exercise the
 * pure helpers (randomToken, pkceChallenge, decodeIdTokenClaims with its role
 * extraction) plus the network-touching helpers (discover, exchangeCode,
 * verifyIdToken) against a mocked globalThis.fetch — no real IdP is contacted.
 *
 * discover/exchangeCode/verifyIdToken all take their config explicitly, so they
 * don't depend on the module-load-time OIDC_* env that other test files set.
 *
 * discover()/exchangeCode() now route through the egress guard (safeFetch), which
 * DNS-resolves any non-IP hostname and fails closed. So the network-touching cases
 * below use loopback-IP issuer/token hosts (net.isIP ≠ 0 ⇒ the guard skips DNS, and
 * loopback isn't in the blocked link-local/metadata range) while still hitting the
 * mocked globalThis.fetch — keeping them pure unit tests with the guard satisfied.
 */
const oidc = await import("../lib/oidc");
const {
  discover,
  exchangeCode,
  verifyIdToken,
  decodeIdTokenClaims,
  randomToken,
  pkceChallenge,
} = oidc;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

const CONFIG = {
  issuerUrl: "https://idp.test",
  clientId: "client-1",
  clientSecret: "shh",
  scope: "openid profile",
  audience: "client-1",
  verifyToken: true,
};

// ── PKCE / random helpers ─────────────────────────────────────────────────────

test("randomToken returns distinct url-safe base64 strings", () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.equal(randomToken(8).length > 0, true);
});

test("pkceChallenge is the base64url SHA-256 of the verifier", () => {
  const verifier = "abc123";
  const expected = crypto.createHash("sha256").update(verifier).digest("base64url");
  assert.equal(pkceChallenge(verifier), expected);
});

// ── decodeIdTokenClaims + role extraction ─────────────────────────────────────

test("decodeIdTokenClaims extracts sub/name/email and flat roles", () => {
  const idToken = `${b64url({ alg: "RS256" })}.${b64url({
    sub: "u1",
    name: "Ada",
    email: "ada@test",
    roles: ["a", "b"],
  })}.sig`;
  const claims = decodeIdTokenClaims(idToken);
  assert.equal(claims?.sub, "u1");
  assert.equal(claims?.name, "Ada");
  assert.equal(claims?.email, "ada@test");
  assert.deepEqual(claims?.roles?.sort(), ["a", "b"]);
});

test("decodeIdTokenClaims falls back to preferred_username and merges role sources", () => {
  const idToken = `${b64url({})}.${b64url({
    sub: "u2",
    preferred_username: "neo",
    groups: "g1 g2",
    realm_access: { roles: ["r1"] },
  })}.sig`;
  const claims = decodeIdTokenClaims(idToken);
  assert.equal(claims?.name, "neo");
  assert.deepEqual(claims?.roles?.sort(), ["g1", "g2", "r1"]);
});

test("decodeIdTokenClaims throws on a non-3-part token (post-verification decode failure)", () => {
  assert.throws(() => decodeIdTokenClaims("not.a.jwt.token"), oidc.InvalidIdTokenClaimsError);
  assert.throws(() => decodeIdTokenClaims("only-one-part"), oidc.InvalidIdTokenClaimsError);
});

test("decodeIdTokenClaims throws on an undecodable payload (post-verification decode failure)", () => {
  assert.throws(() => decodeIdTokenClaims("aaa.@@@not-base64-json@@@.ccc"), oidc.InvalidIdTokenClaimsError);
});

// ── discover ──────────────────────────────────────────────────────────────────
// NOTE: discover() keeps a single module-level cache that is populated only on a
// SUCCESSFUL fetch. The two error-path tests below run BEFORE the success test so
// the cache is empty for them; the success test populates the cache last.

test("discover throws on a non-ok discovery response", async () => {
  globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
  await assert.rejects(
    () => discover({ ...CONFIG, issuerUrl: "https://127.0.0.2" }),
    /OIDC discovery failed \(404\)/,
  );
});

test("discover throws when required endpoints are missing", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ issuer: "x" }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => discover({ ...CONFIG, issuerUrl: "https://127.0.0.3" }),
    /missing required endpoints/,
  );
});

test("discover fetches the well-known document (and caches it)", async () => {
  const doc = {
    // The doc's `issuer` must match the configured issuerUrl (OIDC Discovery spec; now enforced).
    issuer: "https://127.0.0.1",
    authorization_endpoint: "https://idp.test/auth",
    token_endpoint: "https://idp.test/token",
    jwks_uri: "https://idp.test/jwks",
  };
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(doc), { status: 200 });
  }) as typeof fetch;

  const result = await discover({ ...CONFIG, issuerUrl: "https://127.0.0.1" });
  assert.equal(result.token_endpoint, "https://idp.test/token");
  assert.match(calls[0]!, /^https:\/\/127\.0\.0\.1\/\.well-known\/openid-configuration$/);
});

test("discover rejects a document whose issuer doesn't match the configured issuer", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ issuer: "https://evil.test", authorization_endpoint: "https://idp.test/auth", token_endpoint: "https://idp.test/token" }), { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => discover({ ...CONFIG, issuerUrl: "https://127.0.0.5" }),
    /issuer mismatch/,
  );
});

// ── exchangeCode ──────────────────────────────────────────────────────────────

test("exchangeCode posts the code and returns the token response", async () => {
  let seen: { url: string; body: string } | null = null;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(url), body: String(init?.body) };
    return new Response(JSON.stringify({ access_token: "at", id_token: "it" }), { status: 200 });
  }) as typeof fetch;

  const tokens = await exchangeCode({
    config: CONFIG,
    discovery: { authorization_endpoint: "https://idp.test/auth", token_endpoint: "https://127.0.0.1/token" },
    code: "the-code",
    redirectUri: "https://app/callback",
    codeVerifier: "verifier",
  });
  assert.equal(tokens.access_token, "at");
  assert.equal(tokens.id_token, "it");
  assert.equal(seen!.url, "https://127.0.0.1/token");
  assert.match(seen!.body, /grant_type=authorization_code/);
  assert.match(seen!.body, /code=the-code/);
});

test("exchangeCode throws with the upstream status on failure", async () => {
  globalThis.fetch = (async () => new Response("bad grant", { status: 400 })) as typeof fetch;
  await assert.rejects(
    () =>
      exchangeCode({
        config: CONFIG,
        discovery: { authorization_endpoint: "a", token_endpoint: "https://127.0.0.1/token" },
        code: "x",
        redirectUri: "y",
        codeVerifier: "z",
      }),
    /Token exchange failed \(400\)/,
  );
});

// ── verifyIdToken (delegates to jwks) ─────────────────────────────────────────

test("verifyIdToken is a no-op when verifyToken is disabled", async () => {
  await verifyIdToken("any.token.here", { ...CONFIG, verifyToken: false }, {
    authorization_endpoint: "a",
    token_endpoint: "t",
  });
  // No throw == pass.
  assert.ok(true);
});

test("verifyIdToken throws when discovery exposes no jwks_uri", async () => {
  await assert.rejects(
    () =>
      verifyIdToken("a.b.c", CONFIG, { authorization_endpoint: "a", token_endpoint: "t" }),
    /no jwks_uri/,
  );
});

test("verifyIdToken verifies a real RS256 token against a mocked JWKS", async () => {
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "k1" };
  const claims = { sub: "u1", iss: "https://idp.test", aud: "client-1", exp: now + 600 };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = crypto.sign("sha256", Buffer.from(signingInput), rsa.privateKey).toString("base64url");
  const idToken = `${signingInput}.${sig}`;

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })) as typeof fetch;

  await verifyIdToken(idToken, CONFIG, {
    authorization_endpoint: "a",
    token_endpoint: "t",
    issuer: "https://idp.test",
    jwks_uri: `http://127.0.0.1/jwks-${crypto.randomUUID()}`,
  });
  assert.ok(true);
});

test("idTokenAuthTime reads the numeric auth_time claim (null when absent/non-numeric)", () => {
  const withAt = `${b64url({ alg: "RS256" })}.${b64url({ sub: "u", auth_time: 1_700_000_000 })}.sig`;
  assert.equal(oidc.idTokenAuthTime(withAt), 1_700_000_000);
  const without = `${b64url({ alg: "RS256" })}.${b64url({ sub: "u" })}.sig`;
  assert.equal(oidc.idTokenAuthTime(without), null);
  const nonNumeric = `${b64url({ alg: "RS256" })}.${b64url({ sub: "u", auth_time: "nope" })}.sig`;
  assert.equal(oidc.idTokenAuthTime(nonNumeric), null);
});
