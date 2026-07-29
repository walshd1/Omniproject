import { test } from "node:test";
import assert from "node:assert/strict";
import { grantsFromClaims, hasStrongAuth, sessionStrongAuth } from "./rbac";

/**
 * Tamper-resistant MFA gate for pmo/admin: a claim placing someone in the
 * admin/pmo IdP group is necessary but not sufficient — the session must also
 * assert a hardware-bound (WebAuthn/FIDO2-family) authentication method via
 * amr/acr before the authority is actually wielded.
 */

test("hasStrongAuth: true for RFC 8176 hardware/software-key amr values (default set)", () => {
  assert.equal(hasStrongAuth({ amr: ["hwk"] }), true);
  assert.equal(hasStrongAuth({ amr: ["swk"] }), true);
  assert.equal(hasStrongAuth({ amr: ["pwd", "hwk"] }), true); // any qualifying value is enough
});

test("hasStrongAuth: false for password/OTP/SMS-only amr, or no session/claim at all", () => {
  assert.equal(hasStrongAuth({ amr: ["pwd"] }), false);
  assert.equal(hasStrongAuth({ amr: ["otp"] }), false);
  assert.equal(hasStrongAuth({ amr: ["sms"] }), false);
  assert.equal(hasStrongAuth({ amr: [] }), false);
  assert.equal(hasStrongAuth({}), false);
  assert.equal(hasStrongAuth(null), false);
  assert.equal(hasStrongAuth(undefined), false);
});

test("hasStrongAuth: is case-insensitive", () => {
  assert.equal(hasStrongAuth({ amr: ["HWK"] }), true);
});

test("hasStrongAuth: acr is checked only against OIDC_STRONG_ACR_VALUES (empty by default)", () => {
  assert.equal(hasStrongAuth({ acr: "urn:mfa:hardware" }), false); // not in the default (empty) acr set
});

test("grantsFromClaims: withholds admin/pmo authority without strongAuth, but keeps programmeManager base", () => {
  process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
  try {
    const weak = grantsFromClaims(["omni-admins"], { isDemo: false, strongAuth: false });
    assert.equal(weak.authorities.size, 0, "authority withheld without proof of strong auth");
    assert.equal(weak.base, "programmeManager", "the claim still proves programme-management-level trust");

    const strong = grantsFromClaims(["omni-admins"], { isDemo: false, strongAuth: true });
    assert.deepEqual([...strong.authorities], ["admin"]);
    assert.equal(strong.base, "programmeManager");
  } finally {
    delete process.env["OIDC_ADMIN_ROLES"];
  }
});

test("grantsFromClaims: omitting strongAuth entirely does not downgrade (back-compat default)", () => {
  process.env["OIDC_ADMIN_ROLES"] = "omni-admins";
  try {
    const g = grantsFromClaims(["omni-admins"], { isDemo: false });
    assert.deepEqual([...g.authorities], ["admin"]);
  } finally {
    delete process.env["OIDC_ADMIN_ROLES"];
  }
});

test("grantsFromClaims: demo mode is exempt from the strong-auth gate (no real identity to phish)", () => {
  const g = grantsFromClaims([], { isDemo: true, strongAuth: false });
  assert.deepEqual([...g.authorities].sort(), ["admin", "pmo"]);
});

test("sessionStrongAuth: hardware MFA (amr/acr) qualifies regardless of local/env", () => {
  assert.equal(sessionStrongAuth({ amr: ["hwk"] }), true);
  assert.equal(sessionStrongAuth(null), false);
  assert.equal(sessionStrongAuth({ amr: ["pwd"] }), false); // non-local password session, no hardware MFA
});

test("sessionStrongAuth: a local password session qualifies ONLY when the passkey requirement is opted out", () => {
  // Default (LOCAL_ADMIN_REQUIRE_PASSKEY unset ⇒ false): a local password alone is strong, so a fresh
  // IdP-less deployment is administrable out of the box. This is the SAME rule grantsForReq and scopeForReq
  // both apply, so a local admin's data scope matches their tier authority (was: scopeForReq withheld it,
  // collapsing an opted-out local admin to an empty programme scope — admin routes but no data).
  delete process.env["LOCAL_ADMIN_REQUIRE_PASSKEY"];
  assert.equal(sessionStrongAuth({ amr: ["pwd"], local: true }), true);

  // Opted IN (LOCAL_ADMIN_REQUIRE_PASSKEY=true): a local password is NOT strong — a passkey step-up is required.
  process.env["LOCAL_ADMIN_REQUIRE_PASSKEY"] = "true";
  try {
    assert.equal(sessionStrongAuth({ amr: ["pwd"], local: true }), false);
    assert.equal(sessionStrongAuth({ amr: ["hwk"], local: true }), true); // ...unless it also holds hardware MFA
  } finally {
    delete process.env["LOCAL_ADMIN_REQUIRE_PASSKEY"];
  }
});

test("grantsFromClaims: a plain manager/contributor/viewer claim is unaffected by strongAuth", () => {
  process.env["OIDC_MANAGER_ROLES"] = "leads";
  try {
    const weak = grantsFromClaims(["leads"], { isDemo: false, strongAuth: false });
    assert.equal(weak.base, "manager");
    assert.equal(weak.authorities.size, 0);
  } finally {
    delete process.env["OIDC_MANAGER_ROLES"];
  }
});
