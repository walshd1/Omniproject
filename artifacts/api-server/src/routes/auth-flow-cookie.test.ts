import { test } from "node:test";
import assert from "node:assert/strict";

// A stable secret so seal/open derive a key deterministically (set BEFORE importing auth.ts).
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";

const { sealFlowCookie, openFlowCookie } = await import("./auth");

/**
 * Flow cookies (OIDC/OAuth2/SAML step-up) carry the PKCE code_verifier + nonce + state + bound sub. They must
 * be SEALED (AES-256-GCM), never stored as clear-text JSON in the browser (CWE-312 — "clear text storage of
 * sensitive information"). These lock in the seal-on-write / open-on-read contract and its legacy fallback.
 */

test("sealFlowCookie does NOT store the payload in clear text", () => {
  const sealed = sealFlowCookie({ state: "ST", verifier: "pkce-code-verifier-secret-123", sub: "user-42" });
  // The secret must not appear verbatim, and the value must not be readable JSON.
  assert.ok(!sealed.includes("pkce-code-verifier-secret-123"), "verifier leaked in clear text");
  assert.ok(!sealed.includes("verifier"), "payload key leaked in clear text");
  assert.throws(() => JSON.parse(sealed), "sealed cookie must not be plain JSON");
});

test("openFlowCookie round-trips a sealed cookie", () => {
  const payload = { state: "ST", verifier: "v-abc", nonce: "n-1", returnTo: "/home", stepup: true, sub: "u1" };
  const opened = openFlowCookie<typeof payload>(sealFlowCookie(payload));
  assert.deepEqual(opened, payload);
});

test("openFlowCookie falls back to a legacy plaintext cookie (in-flight flows survive the rollout)", () => {
  const legacy = JSON.stringify({ state: "ST", verifier: "v", returnTo: "/" });
  assert.deepEqual(openFlowCookie<{ state: string }>(legacy), { state: "ST", verifier: "v", returnTo: "/" });
});

test("openFlowCookie returns null for missing / garbage input (treated as no flow)", () => {
  assert.equal(openFlowCookie(undefined), null);
  assert.equal(openFlowCookie(""), null);
  assert.equal(openFlowCookie("not json at all {{{"), null);
});
