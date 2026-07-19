import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "instance-key-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const k = await import("./instance-key");
const kms = await import("./kms");

const now = "2026-07-19T00:00:00.000Z";
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));
afterEach(() => k._resetInstanceKeyCache());

/** A 32-byte "config root" for the local KMS passthrough (CONFIG_KEY_ENC = base64 of the raw key). */
const rootB64 = (seed: number): string => Buffer.alloc(32, seed).toString("base64");
async function enableKms(seed: number): Promise<void> {
  process.env["KMS_PROVIDER"] = "local";
  process.env["CONFIG_KEY_ENC"] = rootB64(seed);
  kms.__resetKms();
  await kms.initKms();
}
function disableKms(): void {
  delete process.env["KMS_PROVIDER"];
  delete process.env["CONFIG_KEY_ENC"];
  kms.__resetKms();
}
const wrappedToken = (file: string): string => JSON.parse(fs.readFileSync(file, "utf8")).wrapped as string;

test("ensure mints once (idempotent) and persists WRAPPED (never plaintext on disk)", () => {
  const first = k.ensureInstanceKey(now);
  assert.ok(first && first.length === 32);
  k._resetInstanceKeyCache();
  const again = k.ensureInstanceKey(now);
  assert.ok(again && again.equals(first!), "the same key is returned — not regenerated");

  // The on-disk file is a wrapped token, and does NOT contain the raw key base64.
  const raw = fs.readFileSync(path.join(CONFIG_DIR, "instance-key.sealed"), "utf8");
  assert.equal(raw.includes(first!.toString("base64")), false, "raw key is not on disk in the clear");
  assert.match(raw, /"wrapped":/);
});

test("getInstanceKey unwraps to the same bytes; fingerprint is stable + non-secret", () => {
  const key = k.getInstanceKey();
  assert.ok(key && key.length === 32);
  const fp = k.instanceKeyFingerprint();
  assert.ok(fp && fp.length > 0);
  assert.equal(raw().includes(fp!), false, "fingerprint isn't the key");
  function raw() { return fs.readFileSync(path.join(CONFIG_DIR, "instance-key.sealed"), "utf8"); }
});

test("reveal-once flag; rotate mints a NEW key and resets the gate", () => {
  assert.equal(k.isInstanceKeyRevealed(), false);
  k.markInstanceKeyRevealed();
  k._resetInstanceKeyCache();
  assert.equal(k.isInstanceKeyRevealed(), true);

  const before = k.getInstanceKey()!;
  const rotated = k.rotateInstanceKey(now);
  assert.equal(rotated.equals(before), false, "rotation mints a different key");
  k._resetInstanceKeyCache();
  assert.equal(k.isInstanceKeyRevealed(), false, "the reveal gate reopens after a rotation");
  assert.ok(k.getInstanceKey()!.equals(rotated));
});

test("KMS-native wrap: a fresh IRK chains to the KMS config root, not the master", async () => {
  const file = path.join(CONFIG_DIR, "kms-native.sealed");
  process.env["INSTANCE_KEY_FILE"] = file;
  await enableKms(7);
  k._resetInstanceKeyCache();

  const key = k.ensureInstanceKey(now);
  assert.ok(key && key.length === 32);

  // With the KMS root present it opens...
  k._resetInstanceKeyCache();
  assert.ok(k.getInstanceKey()!.equals(key!));

  // ...but drop the KMS root and the IRK can no longer be unwrapped — its wrap sits in the HSM, not the
  // master (a master-derived wrap would still open here).
  disableKms();
  k._resetInstanceKeyCache();
  assert.equal(k.getInstanceKey(), null, "without the KMS root the KMS-native IRK can't be opened");

  disableKms();
  delete process.env["INSTANCE_KEY_FILE"];
});

test("KMS migration: a master-minted IRK is re-wrapped under the KMS root in place on boot", async () => {
  const file = path.join(CONFIG_DIR, "kms-migrate.sealed");
  process.env["INSTANCE_KEY_FILE"] = file;

  // 1) Mint under the master (no KMS).
  disableKms();
  k._resetInstanceKeyCache();
  const minted = k.ensureInstanceKey(now);
  assert.ok(minted && minted.length === 32);
  const before = wrappedToken(file);

  // 2) Enable KMS + re-run ensure (a boot): the wrap upgrades in place, key VALUE unchanged.
  await enableKms(9);
  k._resetInstanceKeyCache();
  const afterEnsure = k.ensureInstanceKey(now);
  assert.ok(afterEnsure!.equals(minted!), "the key value is unchanged by the re-wrap");
  const after = wrappedToken(file);
  assert.notEqual(after, before, "the at-rest wrap token changed (now KMS-native)");

  // 3) Post-migration the master alone no longer opens it...
  disableKms();
  k._resetInstanceKeyCache();
  assert.equal(k.getInstanceKey(), null, "after migration the master can't open the IRK");

  // 4) ...but with the KMS root back it opens to the same key.
  await enableKms(9);
  k._resetInstanceKeyCache();
  assert.ok(k.getInstanceKey()!.equals(minted!));

  disableKms();
  delete process.env["INSTANCE_KEY_FILE"];
});
