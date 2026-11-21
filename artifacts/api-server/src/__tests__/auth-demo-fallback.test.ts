import { test, before, after } from "node:test";
import assert from "node:assert/strict";

/**
 * Regression for the demo-session fallback authn bypass (security audit C1).
 *
 * `GET /api/auth/login` minted a `demo-user` session whenever NO OIDC provider was configured —
 * keying only on `!getOidcProvider()`, never on the actual demo posture. On a deployment whose real
 * auth is a NON-OIDC method (native local users here; equally SAML / OAuth2 / magic-link), OIDC is
 * absent yet the deployment is NOT demo, so an anonymous caller received a valid sealed session that
 * resolves to `contributor` (write access) — an unauthenticated auth bypass.
 *
 * The demo decision is `isDemoAuth()`, which reads `process.env` (+ the live local-user directory)
 * per request, so we can exercise both postures against one booted app by toggling the env between
 * requests. NOTE: `fetch` follows redirects by default and the mint rides a 302's `Set-Cookie`, so
 * every probe here uses `redirect: "manual"` — otherwise the intermediate cookie is invisible.
 */
process.env["SESSION_SECRET"] = "integration-harness-secret";
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["SECURITY_STRICT"] = "off";
for (const k of [
  "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_PROVIDERS",
  "OAUTH2_CLIENT_ID", "OAUTH2_AUTH_URL", "OAUTH2_TOKEN_URL",
  "SAML_IDP_METADATA_URL", "SAML_IDP_SSO_URL", "SAML_IDP_CERT", "MAGIC_LINK_ENABLED",
  "LOCAL_USERS_ENABLED",
]) delete process.env[k];

const { startHarness } = await import("./_harness");
type Harness = Awaited<ReturnType<typeof startHarness>>;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());

async function loginProbe(): Promise<{ status: number; sessionMinted: boolean }> {
  const res = await fetch(`${h.base}/api/auth/login`, { method: "GET", redirect: "manual" });
  const cookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const sessionMinted = cookies.some((c) => c.startsWith("omni_session=") && !c.startsWith("omni_session=;"));
  return { status: res.status, sessionMinted };
}

test("non-demo deployment (native local users, no OIDC): /auth/login mints NO session", async () => {
  process.env["LOCAL_USERS_ENABLED"] = "true"; // a real, non-OIDC login method ⇒ isDemoAuth() === false
  try {
    const { status, sessionMinted } = await loginProbe();
    assert.equal(sessionMinted, false, "an anonymous caller must not receive a session on a non-demo deployment");
    assert.ok(status >= 400 && status < 500, `expected a 4xx refusal, got ${status}`);
  } finally {
    delete process.env["LOCAL_USERS_ENABLED"];
  }
});

test("genuine demo deployment (no auth method at all): /auth/login still mints the demo session", async () => {
  // Preserve the out-of-the-box demo experience: with no real auth configured, demo login is intended.
  const { status, sessionMinted } = await loginProbe();
  assert.equal(sessionMinted, true, "demo mode should still establish the demo session");
  assert.equal(status, 302);
});
