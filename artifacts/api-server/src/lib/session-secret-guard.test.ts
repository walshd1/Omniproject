import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSessionSecret, resolveSessionSecret, DEV_SESSION_SECRET } from "./session-secret-guard";

/**
 * The session-cookie secret's boot-time guard. `evaluateSessionSecret` is pure so the
 * full matrix is tested directly; `resolveSessionSecret` additionally exercises the
 * throw-on-failure boot hook.
 *
 * The scenario this exists to close: a deployment that points at a real IdP (or has a
 * licence, or a public hostname) but never set SESSION_SECRET, while NODE_ENV isn't the
 * exact string "production" (unset, "staging", a typo, ...). Before this guard existed,
 * that combination booted fine and signed every session with a hardcoded, public
 * secret — this test proves it now refuses to.
 */

test("a plain dev/test environment (no production signals) is fine with no secret set", () => {
  const r = evaluateSessionSecret({ NODE_ENV: "development" });
  assert.equal(r.ok, true);
  assert.equal(r.looksProduction, false);
  assert.equal(r.secret, DEV_SESSION_SECRET);
});

test("NODE_ENV=production with no secret set is refused (the original, already-covered case)", () => {
  const r = evaluateSessionSecret({ NODE_ENV: "production" });
  assert.equal(r.ok, false);
  assert.equal(r.looksProduction, true);
});

test("NODE_ENV=production with the literal dev-default secret is still refused", () => {
  const r = evaluateSessionSecret({ NODE_ENV: "production", SESSION_SECRET: DEV_SESSION_SECRET });
  assert.equal(r.ok, false);
});

test("NODE_ENV=production with a real secret is accepted", () => {
  const r = evaluateSessionSecret({ NODE_ENV: "production", SESSION_SECRET: "a-strong-random-secret" });
  assert.equal(r.ok, true);
  assert.equal(r.secret, "a-strong-random-secret");
});

test("real OIDC configured + NODE_ENV NOT literally 'production' + no secret is now refused (the gap this closes)", () => {
  const r = evaluateSessionSecret({ NODE_ENV: "development", OIDC_ISSUER_URL: "https://idp.example.com" });
  assert.equal(r.ok, false);
  assert.equal(r.looksProduction, true);
  assert.ok(r.signals.some((s) => s.includes("OIDC")));
});

test("real OIDC configured + NODE_ENV unset + no secret is also refused", () => {
  const r = evaluateSessionSecret({ OIDC_ISSUER_URL: "https://idp.example.com" });
  assert.equal(r.ok, false);
});

test("real OIDC configured + a genuinely strong secret set (NODE_ENV not 'production') is accepted", () => {
  const r = evaluateSessionSecret({
    NODE_ENV: "staging",
    OIDC_ISSUER_URL: "https://idp.example.com",
    SESSION_SECRET: "a-strong-random-secret",
  });
  assert.equal(r.ok, true);
});

test("a licence configured, no secret, NODE_ENV not production is refused", () => {
  const r = evaluateSessionSecret({ LICENSE_KEY: "some-licence" });
  assert.equal(r.ok, false);
  assert.ok(r.signals.some((s) => s.includes("licence")));
});

test("a public PUBLIC_URL, no secret, NODE_ENV not production is refused", () => {
  const r = evaluateSessionSecret({ PUBLIC_URL: "https://omni.example.com" });
  assert.equal(r.ok, false);
  assert.ok(r.signals.some((s) => s.includes("PUBLIC_URL")));
});

test("a LOCAL PUBLIC_URL (localhost) is not treated as a production signal", () => {
  const r = evaluateSessionSecret({ PUBLIC_URL: "http://localhost:3000" });
  assert.equal(r.ok, true);
});

test("resolveSessionSecret throws with a message naming the specific signal", () => {
  assert.throws(
    () => resolveSessionSecret({ OIDC_ISSUER_URL: "https://idp.example.com" }),
    /looks like a production deployment.*OIDC_ISSUER_URL/,
  );
});

test("resolveSessionSecret returns the secret when the guard passes", () => {
  assert.equal(resolveSessionSecret({ NODE_ENV: "development" }), DEV_SESSION_SECRET);
  assert.equal(
    resolveSessionSecret({ NODE_ENV: "production", SESSION_SECRET: "a-strong-random-secret" }),
    "a-strong-random-secret",
  );
});
