import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "instance-key-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

const k = await import("./instance-key");

const now = "2026-07-19T00:00:00.000Z";
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));
afterEach(() => k._resetInstanceKeyCache());

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
