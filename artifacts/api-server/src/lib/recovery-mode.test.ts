import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["SESSION_SECRET"] ??= "test-session-secret-do-not-use";
const { engageRecoveryConfigDir, recoveryConfigDir } = await import("./recovery-mode");

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-mode-"));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));
afterEach(() => { delete process.env["LOCAL_PASSWORD_RECOVERY"]; });

test("recovery OFF → no redirect (returns the base dir untouched)", () => {
  const env = { OMNI_CONFIG_DIR: BASE } as NodeJS.ProcessEnv;
  assert.equal(engageRecoveryConfigDir(env), BASE);
  assert.equal(env["OMNI_CONFIG_DIR"], BASE);
});

test("recovery ON → redirects OMNI_CONFIG_DIR to an isolated recovery/ subdir (created)", () => {
  const env = { OMNI_CONFIG_DIR: BASE, LOCAL_PASSWORD_RECOVERY: "true" } as NodeJS.ProcessEnv;
  const dir = engageRecoveryConfigDir(env);
  assert.equal(dir, recoveryConfigDir(BASE));
  assert.equal(env["OMNI_CONFIG_DIR"], recoveryConfigDir(BASE), "env is redirected so every store follows");
  assert.ok(fs.existsSync(recoveryConfigDir(BASE)), "the recovery dir is created");
  // The ORIGINAL dir is untouched (data preserved, just not loaded).
  assert.ok(fs.existsSync(BASE));
});

test("idempotent — won't nest recovery/recovery when already engaged", () => {
  const already = recoveryConfigDir(BASE);
  const env = { OMNI_CONFIG_DIR: already, LOCAL_PASSWORD_RECOVERY: "true" } as NodeJS.ProcessEnv;
  assert.equal(engageRecoveryConfigDir(env), already);
  assert.equal(env["OMNI_CONFIG_DIR"], already);
});

test("no OMNI_CONFIG_DIR → null (nothing to isolate)", () => {
  assert.equal(engageRecoveryConfigDir({ LOCAL_PASSWORD_RECOVERY: "true" } as NodeJS.ProcessEnv), null);
});
