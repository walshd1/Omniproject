import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Enable persistence on a temp dir + a fixed credential root BEFORE importing the module.
process.env["SESSION_SECRET"] = "test-session-secret-do-not-use";
process.env["USERCRED_SECRET"] = "test-usercred-root-A";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "user-creds-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const creds = await import("./user-credentials");
const { aesGcmOpen } = await import("./crypto-aes-gcm");
const { deriveKey } = await import("./crypto-keys");

after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));
afterEach(() => creds._resetCredentialCache());

test("set → verify round-trips; wrong password fails", () => {
  creds.setPassword("local:u1", "correct horse battery");
  assert.equal(creds.hasPassword("local:u1"), true);
  assert.equal(creds.verifyPassword("local:u1", "correct horse battery"), true);
  assert.equal(creds.verifyPassword("local:u1", "wrong"), false);
  // A non-existent user verifies false (and doesn't throw).
  assert.equal(creds.verifyPassword("local:ghost", "whatever"), false);
});

test("password policy is enforced", () => {
  assert.throws(() => creds.setPassword("local:u2", "short"), /at least 8/);
  assert.throws(() => creds.assertPasswordPolicy(123 as unknown as string), /must be a string/);
});

test("removePassword clears the credential", () => {
  creds.setPassword("local:u3", "another good password");
  assert.equal(creds.removePassword("local:u3"), true);
  assert.equal(creds.hasPassword("local:u3"), false);
  assert.equal(creds.removePassword("local:u3"), false);
});

test("the RECOVERY break-glass re-keys the store, invalidating existing credentials (destructive)", () => {
  creds.setPassword("local:u5", "pre-recovery password");
  assert.equal(creds.verifyPassword("local:u5", "pre-recovery password"), true);
  // Engage recovery: the credential key domain changes, so the pre-recovery sealed store can't be opened.
  process.env["LOCAL_PASSWORD_RECOVERY"] = "true";
  creds._resetCredentialCache();
  try {
    assert.equal(creds.verifyPassword("local:u5", "pre-recovery password"), false, "old credential is invalidated");
    assert.equal(creds.hasPassword("local:u5"), false, "the store reads empty under the recovery key");
    // A fresh credential works under the recovery key (start afresh).
    creds.setPassword("local:u6", "post-recovery password");
    assert.equal(creds.verifyPassword("local:u6", "post-recovery password"), true);
  } finally {
    delete process.env["LOCAL_PASSWORD_RECOVERY"];
    creds._resetCredentialCache();
  }
});

test("the store is SEPARATELY KEYED — sealed under usercreds:v1, not the config key", () => {
  creds.setPassword("local:u4", "keyed password value");
  const file = path.join(CONFIG_DIR, "user-credentials.sealed");
  const raw = fs.readFileSync(file, "utf8");
  // It opens under the credential key (root USERCRED_SECRET + info "usercreds:v1")…
  const rightKey = deriveKey("test-usercred-root-A", "usercreds:v1");
  assert.ok(aesGcmOpen(raw, rightKey), "opens under the credential key");
  // …and NOT under a different root (a compromise of another key domain can't read passwords).
  const wrongKey = deriveKey("some-other-root", "usercreds:v1");
  assert.equal(aesGcmOpen(raw, wrongKey), null, "does not open under a foreign key");
  // The plaintext hash never contains the password.
  assert.equal(raw.includes("keyed password value"), false);
});
