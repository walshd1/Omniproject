import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSessionSecretForLocalPrincipals, DEV_SESSION_SECRET } from "./session-secret-guard";

/**
 * Regression for the CRITICAL red-team finding (2026-07-21): a deployment with the artifact store enabled and
 * a real native-local admin — but no SSO env and SESSION_SECRET unset — used to boot on the PUBLIC default
 * secret. The import-time `evaluateSessionSecret` guard is blind to this because the user directory loads
 * AFTER it runs, and `isDemoAuthFrom` only counts the *env* flag `LOCAL_USERS_ENABLED`, not the live roster.
 * `assertSessionSecretForLocalPrincipals` is the post-config-load re-check the boot path now runs with the
 * REAL runtime signal (`localUsersActive()`). These tests drive that real signal end-to-end, not a mock.
 */

const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sess-localuser-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
// Import AFTER OMNI_CONFIG_DIR is set so the artifact store resolves this throwaway dir.
const dir = await import("./user-directory");
const now = "2026-07-21T00:00:00.000Z";
const STRONG = "a-strong-non-default-session-secret-0123456789ab";

after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));
afterEach(() => { for (const u of dir.listUsers()) dir.deleteUser(u.id); });

test("no local accounts yet → the default secret is tolerated (demo / CI stays green)", () => {
  assert.equal(dir.localUsersActive(), false);
  // A throwaway store with zero accounts (exactly the CI n8n-contract shape) must NOT be forced to a secret.
  assert.doesNotThrow(() => assertSessionSecretForLocalPrincipals(dir.localUsersActive(), {}));
  assert.doesNotThrow(() => assertSessionSecretForLocalPrincipals(dir.localUsersActive(), { SESSION_SECRET: DEV_SESSION_SECRET }));
});

test("an ACTIVE local account + a missing/default SESSION_SECRET is REFUSED (the exploit condition)", () => {
  dir.createUser({ userName: "root", groups: ["omni-admins"] }, "tester", now);
  assert.equal(dir.localUsersActive(), true);
  assert.throws(() => assertSessionSecretForLocalPrincipals(dir.localUsersActive(), {}), /SESSION_SECRET must be set/);
  assert.throws(
    () => assertSessionSecretForLocalPrincipals(dir.localUsersActive(), { SESSION_SECRET: DEV_SESSION_SECRET }),
    /SESSION_SECRET must be set/,
  );
  assert.throws(() => assertSessionSecretForLocalPrincipals(dir.localUsersActive(), { SESSION_SECRET: "   " }), /SESSION_SECRET must be set/);
});

test("an ACTIVE local account + a STRONG SESSION_SECRET boots fine", () => {
  dir.createUser({ userName: "root", groups: ["omni-admins"] }, "tester", now);
  assert.equal(dir.localUsersActive(), true);
  assert.doesNotThrow(() => assertSessionSecretForLocalPrincipals(dir.localUsersActive(), { SESSION_SECRET: STRONG }));
});

test("an INACTIVE local account does not trip the guard (it can't log in)", () => {
  const u = dir.createUser({ userName: "ghost", groups: [] }, "tester", now);
  dir.updateUser(u.id, { active: false }, now);
  assert.equal(dir.localUsersActive(), false);
  assert.doesNotThrow(() => assertSessionSecretForLocalPrincipals(dir.localUsersActive(), {}));
});
