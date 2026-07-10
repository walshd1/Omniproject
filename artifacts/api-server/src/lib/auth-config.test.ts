import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Regression for the demo-mode privilege-escalation: demo mode (which grants every session full
 * admin) must be inferred from the absence of EVERY real auth method — not from the legacy
 * `OIDC_ISSUER_URL` var alone. Here a real method (magic-link) is configured while the legacy var is
 * deliberately unset; the pre-fix `!OIDC_ISSUER_URL` check would report demo mode and elevate every
 * user to admin. Env is set before importing, since the auth-config inputs read env at module load.
 */
delete process.env["OIDC_ISSUER_URL"];
delete process.env["OIDC_PROVIDERS"];
process.env["MAGIC_LINK_ENABLED"] = "true";

const { isDemoAuth } = await import("./auth-config");

test("isDemoAuth is FALSE when a real auth method is configured but the legacy OIDC_ISSUER_URL is unset", () => {
  // magic-link is a real login method; the gateway must NOT treat this as demo mode.
  assert.equal(isDemoAuth(), false);
});
