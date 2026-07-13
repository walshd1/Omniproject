import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { __setEgressTransportForTest } from "../lib/egress";

/**
 * OIDC relying-party helpers (lib/oidc). The protocol state machine now runs through openid-client;
 * these tests cover (a) the pure app helpers still owned here (randomToken, pkceChallenge, the
 * claim→SessionUser role extraction) and (b) an END-TO-END flow — discoverConfig → buildOidcAuthUrl →
 * completeOidcLogin — driven against a mocked IdP (discovery + JWKS + token), with a REAL RS256
 * id_token minted here and verified by openid-client/jose. No real IdP is contacted.
 *
 * openid-client's HTTP all routes through safeFetch (SSRF-guarded); the egress transport is bridged
 * to the in-test mock router below. A loopback-IP issuer keeps the egress guard satisfied (net.isIP ≠ 0
 * ⇒ no DNS; loopback isn't blocked) while every hop still lands on the mock.
 */
const oidc = await import("../lib/oidc");
const { randomToken, pkceChallenge, claimsToSessionUser, discoverConfig, buildOidcAuthUrl, completeOidcLogin, __clearOidcConfigCache } = oidc;

const ISSUER = "https://127.0.0.1";
let router: (url: string, init?: RequestInit) => Promise<Response>;
beforeEach(() => {
  __clearOidcConfigCache();
  __setEgressTransportForTest((url, init) => router(String(url), init as RequestInit));
});
afterEach(() => { __setEgressTransportForTest(null); __clearOidcConfigCache(); });

const CONFIG = {
  issuerUrl: ISSUER,
  clientId: "client-1",
  clientSecret: "shh",
  scope: "openid profile email",
  audience: "client-1",
  verifyToken: true,
};

// ── pure helpers ───────────────────────────────────────────────────────────────
test("randomToken returns distinct url-safe base64 strings", () => {
  const a = randomToken();
  assert.notEqual(a, randomToken());
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("pkceChallenge is the base64url SHA-256 of the verifier", () => {
  assert.equal(pkceChallenge("abc123"), crypto.createHash("sha256").update("abc123").digest("base64url"));
});

// ── claim → SessionUser mapping (the app-specific claim shapes) ──────────────────
test("claimsToSessionUser extracts sub/name/email and flat roles", () => {
  const u = claimsToSessionUser({ sub: "u1", name: "Ada", email: "ada@test", roles: ["a", "b"] });
  assert.equal(u.sub, "u1");
  assert.equal(u.name, "Ada");
  assert.equal(u.email, "ada@test");
  assert.deepEqual(u.roles?.sort(), ["a", "b"]);
});

test("claimsToSessionUser falls back to preferred_username and merges role sources", () => {
  const u = claimsToSessionUser({ sub: "u2", preferred_username: "neo", groups: "g1 g2", realm_access: { roles: ["r1"] } });
  assert.equal(u.name, "neo");
  assert.deepEqual(u.roles?.sort(), ["g1", "g2", "r1"]);
});

test("claimsToSessionUser reads amr as an array or a space-delimited string; acr only when a string", () => {
  assert.deepEqual(claimsToSessionUser({ sub: "u", amr: ["hwk", "mfa"] }).amr, ["hwk", "mfa"]);
  assert.deepEqual(claimsToSessionUser({ sub: "u", amr: "hwk mfa" }).amr, ["hwk", "mfa"]);
  assert.equal(claimsToSessionUser({ sub: "u", acr: "urn:strong" }).acr, "urn:strong");
  assert.equal(claimsToSessionUser({ sub: "u", acr: 3 }).acr, undefined);
});

// ── end-to-end OIDC flow via openid-client + a mocked IdP ────────────────────────
function makeIdp() {
  const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const discovery = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
  function mintIdToken(claims: Record<string, unknown>): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT", kid: "k1" };
    const payload = { iss: ISSUER, aud: "client-1", iat: now, exp: now + 600, ...claims };
    const input = `${b64(header)}.${b64(payload)}`;
    const sig = crypto.sign("sha256", Buffer.from(input), rsa.privateKey).toString("base64url");
    return `${input}.${sig}`;
  }
  return { jwk, discovery, mintIdToken };
}

test("discoverConfig + buildOidcAuthUrl builds an Authorization-Code + S256 PKCE URL through openid-client", async () => {
  const idp = makeIdp();
  router = async (url) => {
    if (url.endsWith("/.well-known/openid-configuration")) return new Response(JSON.stringify(idp.discovery), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const config = await discoverConfig(CONFIG);
  const url = new URL(await buildOidcAuthUrl({ config, provider: CONFIG, redirectUri: "https://app/cb", state: "st", nonce: "no", verifier: "verifier-1234567890" }));
  assert.equal(url.origin + url.pathname, `${ISSUER}/authorize`);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(url.searchParams.get("state"), "st");
  assert.equal(url.searchParams.get("nonce"), "no");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), pkceChallenge("verifier-1234567890"));
  // step-up: prompt=login + max_age=0
  const stepUp = new URL(await buildOidcAuthUrl({ config, provider: CONFIG, redirectUri: "https://app/cb", state: "s", nonce: "n", verifier: "v", prompt: "login" }));
  assert.equal(stepUp.searchParams.get("prompt"), "login");
  assert.equal(stepUp.searchParams.get("max_age"), "0");
});

test("completeOidcLogin exchanges the code + validates a real RS256 id_token, mapping claims + auth_time", async () => {
  const idp = makeIdp();
  const idToken = idp.mintIdToken({ sub: "u-42", name: "Ada", email: "ada@corp", roles: ["omni-admins"], nonce: "NONCE", auth_time: Math.floor(Date.now() / 1000) });
  router = async (url) => {
    if (url.endsWith("/.well-known/openid-configuration")) return new Response(JSON.stringify(idp.discovery), { status: 200 });
    if (url.endsWith("/jwks")) return new Response(JSON.stringify({ keys: [idp.jwk] }), { status: 200 });
    if (url.endsWith("/token")) return new Response(JSON.stringify({ access_token: "AT", id_token: idToken, token_type: "Bearer" }), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const config = await discoverConfig(CONFIG);
  const currentUrl = new URL(`${ISSUER}/api/auth/callback?code=THE_CODE&state=STATE`);
  const result = await completeOidcLogin({ config, currentUrl, expectedState: "STATE", expectedNonce: "NONCE", verifier: "verifier-1234567890" });
  assert.equal(result.user.sub, "u-42");
  assert.equal(result.user.email, "ada@corp");
  assert.deepEqual(result.user.roles, ["omni-admins"]);
  assert.equal(result.accessToken, "AT");
  assert.ok(result.authTime && result.authTime > 0);
});

test("completeOidcLogin rejects a nonce mismatch (openid-client enforces the binding)", async () => {
  const idp = makeIdp();
  const idToken = idp.mintIdToken({ sub: "u", nonce: "DIFFERENT" });
  router = async (url) => {
    if (url.endsWith("/.well-known/openid-configuration")) return new Response(JSON.stringify(idp.discovery), { status: 200 });
    if (url.endsWith("/jwks")) return new Response(JSON.stringify({ keys: [idp.jwk] }), { status: 200 });
    if (url.endsWith("/token")) return new Response(JSON.stringify({ access_token: "AT", id_token: idToken, token_type: "Bearer" }), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  const config = await discoverConfig(CONFIG);
  const currentUrl = new URL(`${ISSUER}/api/auth/callback?code=C&state=STATE`);
  await assert.rejects(() => completeOidcLogin({ config, currentUrl, expectedState: "STATE", expectedNonce: "NONCE", verifier: "v" }));
});
