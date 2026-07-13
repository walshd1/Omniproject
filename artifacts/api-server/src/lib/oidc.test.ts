import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsToSessionUser } from "./oidc";

/**
 * NOTE: id_token nonce binding, signature, iss/aud/exp and the payload decode are now enforced by
 * openid-client (see the end-to-end flow in __tests__/oidc-helpers.test.ts — a real RS256 token is
 * minted and a nonce mismatch is rejected). What remains app-specific is claimsToSessionUser, which
 * maps ALREADY-VALIDATED claims onto the session's user shape; its robustness is covered here.
 */

test("claimsToSessionUser tolerates missing/oddly-typed claims without throwing", () => {
  assert.equal(claimsToSessionUser({}).sub, ""); // absent sub → empty string (caller coerces to 'unknown')
  const u = claimsToSessionUser({ sub: 123 as unknown as string });
  assert.equal(u.sub, "123"); // coerced to string
  assert.equal(u.name, undefined);
  assert.equal(u.email, undefined);
  assert.deepEqual(u.roles, []);
});

test("claimsToSessionUser dedupes + splits roles across the common IdP claim shapes", () => {
  const u = claimsToSessionUser({ sub: "u1", roles: ["a", "a"], groups: "b,c a", realm_access: { roles: ["c", "d"] } });
  assert.deepEqual(u.roles?.sort(), ["a", "b", "c", "d"]);
});
