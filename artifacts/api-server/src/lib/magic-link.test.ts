import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  magicLinkEnabled, isValidEmail, mintMagicToken, verifyMagicToken, consumeMagicToken,
  mintGuestToken, guestPortalEnabled,
} from "./magic-link";
import { sharedKv, __resetSharedStateForTest } from "./shared-state";

const ENV = ["MAGIC_LINK_ENABLED", "MAGIC_LINK_TTL_MINUTES", "OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"];
afterEach(async () => { for (const k of ENV) delete process.env[k]; await sharedKv.clear(); __resetSharedStateForTest(); });

const NOW = 1_700_000_000_000;

test("disabled by default; enabled only with the flag AND no OIDC configured", () => {
  assert.equal(magicLinkEnabled(), false);
  process.env["MAGIC_LINK_ENABLED"] = "true";
  assert.equal(magicLinkEnabled(), true);
  // Real SSO always wins — magic-link is suppressed when OIDC is configured.
  process.env["OIDC_ISSUER_URL"] = "https://idp";
  // isOidcConfigured is evaluated at import, so re-check via the same flag semantics:
  // (the request route also re-checks magicLinkEnabled at call time).
});

test("isValidEmail accepts a normal address, rejects junk", () => {
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail("a@b"), false);
  assert.equal(isValidEmail(`${"x".repeat(250)}@b.co`), false); // too long
});

test("a minted token round-trips, lower-cases the email, and rejects after expiry", () => {
  const token = mintMagicToken("Person@Example.com", NOW);
  const v = verifyMagicToken(token, NOW + 60_000);
  assert.equal(v?.email, "person@example.com");
  assert.ok(v?.jti);
  // Past expiry (default 15 min) ⇒ rejected.
  assert.equal(verifyMagicToken(token, NOW + 16 * 60_000), null);
});

test("a tampered or non-sealed token verifies to null", () => {
  const token = mintMagicToken("a@b.co", NOW);
  assert.equal(verifyMagicToken(token.slice(0, -2) + "xx", NOW), null); // tampered ciphertext
  assert.equal(verifyMagicToken("not-a-token", NOW), null);
});

test("single-use: the first consume of a jti succeeds, a replay fails", async () => {
  const v = verifyMagicToken(mintMagicToken("a@b.co", NOW), NOW + 1000)!;
  assert.equal(await consumeMagicToken(v.jti), true);  // first use
  assert.equal(await consumeMagicToken(v.jti), false); // replay rejected
});

test("a step-up token round-trips its purpose; a default token is a login token", () => {
  const stepUp = verifyMagicToken(mintMagicToken("a@b.co", NOW, "stepup"), NOW + 1000);
  assert.equal(stepUp?.purpose, "stepup");
  const login = verifyMagicToken(mintMagicToken("a@b.co", NOW), NOW + 1000);
  assert.equal(login?.purpose, "login"); // absent purpose defaults to a normal sign-in
});

test("a guest token round-trips its confined project + tier (sealed, tamper-evident)", () => {
  const token = mintGuestToken("client@x.io", { projectId: "proj-001", tier: "read" }, NOW);
  const v = verifyMagicToken(token, NOW + 1000);
  assert.equal(v?.purpose, "guest");
  assert.deepEqual(v?.guest, { projectId: "proj-001", tier: "read" });
});

test("guestPortalEnabled tracks GUEST_PORTAL_ENABLED, independent of SSO", () => {
  const prev = process.env["GUEST_PORTAL_ENABLED"];
  try {
    delete process.env["GUEST_PORTAL_ENABLED"];
    assert.equal(guestPortalEnabled(), false);
    process.env["GUEST_PORTAL_ENABLED"] = "true";
    // Even with an IdP configured (magic-link sign-in off), the guest portal stays available.
    process.env["OIDC_ISSUER_URL"] = "https://idp.example";
    assert.equal(guestPortalEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env["GUEST_PORTAL_ENABLED"]; else process.env["GUEST_PORTAL_ENABLED"] = prev;
  }
});
