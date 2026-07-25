import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  captureReleaseBackup, latestReleaseBackup, latestReleaseBackupMeta, runningDigest,
  restoreReleaseBackup, runRestoreExecutor, ensurePreAdoptBackupHook, __resetReleaseBackupStore,
  RELEASE_BACKUP_SCHEMA,
} from "./release-backup";
import { recordApprovedPromotion, __resetPromotion, setPromotionRecordedHook } from "./release-promotion";

/**
 * Phase-4 auto-backup + digest-bound restore (docs/UPDATE-MECHANISM.md §6). A pre-adopt backup captures the
 * complete sealed state tagged with the running code digest; a restore is refused unless the rollback target
 * equals that digest (you may only restore the data-state that belongs to the code you roll back to).
 */

const D = "sha256:deadbeefcafe0123";
const OTHER = "sha256:0000111122223333";
let backupFile: string;
let savedManifest: string | undefined;
let savedFile: string | undefined;

/** Make loadSignedRelease() (hence runningDigest()) report digest `d`, or an unattested build when null. */
function setRunningDigest(d: string | null): void {
  if (d === null) { delete process.env["RELEASE_MANIFEST"]; return; }
  process.env["RELEASE_MANIFEST"] = JSON.stringify({
    manifest: { version: "1.0.0", gitSha: "abc123", builtAt: "2026-01-01T00:00:00.000Z", digest: d },
    signature: "not-verified-here", // loadSignedRelease PARSES only; signature check is a separate step
  });
}

before(() => {
  savedManifest = process.env["RELEASE_MANIFEST"];
  savedFile = process.env["RELEASE_BACKUP_FILE"];
  backupFile = path.join(os.tmpdir(), `release-backup-test-${process.pid}.json`);
  process.env["RELEASE_BACKUP_FILE"] = backupFile;
});
after(() => {
  if (savedManifest === undefined) delete process.env["RELEASE_MANIFEST"]; else process.env["RELEASE_MANIFEST"] = savedManifest;
  if (savedFile === undefined) delete process.env["RELEASE_BACKUP_FILE"]; else process.env["RELEASE_BACKUP_FILE"] = savedFile;
  try { fs.rmSync(backupFile, { force: true }); } catch { /* best-effort */ }
  setPromotionRecordedHook(null);
});
beforeEach(() => {
  try { fs.rmSync(backupFile, { force: true }); } catch { /* best-effort */ }
  __resetReleaseBackupStore();
  __resetPromotion();
  setPromotionRecordedHook(null);
  setRunningDigest(D);
});

test("runningDigest reports the signed manifest's digest, or null when unattested", () => {
  setRunningDigest(D);
  assert.equal(runningDigest(), D);
  setRunningDigest(null);
  assert.equal(runningDigest(), null);
});

test("captureReleaseBackup seals the state, tags it with the running digest, and round-trips", () => {
  const backup = captureReleaseBackup("2026-07-25T00:00:00.000Z");
  assert.equal(backup.schema, RELEASE_BACKUP_SCHEMA);
  assert.equal(backup.digest, D);
  assert.equal(backup.full.schema, "omniproject/full-backup-sealed");
  assert.ok(typeof backup.security === "string" && backup.security.length > 0);

  const stored = latestReleaseBackup();
  assert.equal(stored?.digest, D);
  assert.equal(stored?.takenAt, "2026-07-25T00:00:00.000Z");
});

test("latestReleaseBackupMeta exposes only non-secret metadata (no ciphertext)", () => {
  captureReleaseBackup("2026-07-25T00:00:00.000Z");
  const meta = latestReleaseBackupMeta();
  assert.deepEqual(Object.keys(meta ?? {}).sort(), ["digest", "keyFingerprint", "takenAt"]);
  assert.equal(meta?.digest, D);
});

test("restore is REFUSED for a non-digest target", () => {
  captureReleaseBackup("2026-07-25T00:00:00.000Z");
  const r = restoreReleaseBackup("v2", "admin-1", "2026-07-25T01:00:00.000Z");
  assert.equal(r.restored, false);
  assert.match(r.reason ?? "", /content digest/);
});

test("restore is REFUSED when no backup is stored", () => {
  const r = restoreReleaseBackup(D, "admin-1", "2026-07-25T01:00:00.000Z");
  assert.equal(r.restored, false);
  assert.match(r.reason ?? "", /no pre-adopt backup/);
});

test("restore is REFUSED when the target digest does not match the backup's digest (bound-to-digest)", () => {
  captureReleaseBackup("2026-07-25T00:00:00.000Z"); // tagged with D
  const r = restoreReleaseBackup(OTHER, "admin-1", "2026-07-25T01:00:00.000Z");
  assert.equal(r.restored, false);
  assert.match(r.reason ?? "", /does not match rollback target/);
});

test("restore is REFUSED when the backup is not bound to a digest (unattested build)", () => {
  setRunningDigest(null); // capture under an unattested build → digest null
  captureReleaseBackup("2026-07-25T00:00:00.000Z");
  const r = restoreReleaseBackup(D, "admin-1", "2026-07-25T01:00:00.000Z");
  assert.equal(r.restored, false);
  assert.match(r.reason ?? "", /not bound to a digest/);
});

test("restore SUCCEEDS when the rollback target matches the backup's digest", () => {
  captureReleaseBackup("2026-07-25T00:00:00.000Z"); // tagged with D
  const r = restoreReleaseBackup(D, "admin-1", "2026-07-25T01:00:00.000Z");
  assert.equal(r.restored, true);
  assert.equal(r.securityRestored, true);
});

test("runRestoreExecutor applies on a matching digest and throws on a refused restore", () => {
  captureReleaseBackup("2026-07-25T00:00:00.000Z");
  assert.doesNotThrow(() => runRestoreExecutor({ digest: D, actorSub: "admin-2" }));
  assert.throws(() => runRestoreExecutor({ actorSub: "admin-2" }), /missing its digest/);
  assert.throws(() => runRestoreExecutor({ digest: OTHER, actorSub: "admin-2" }), /does not match/);
});

test("ensurePreAdoptBackupHook auto-captures the outgoing state when a promotion is recorded", () => {
  assert.equal(latestReleaseBackup(), null); // nothing captured yet
  ensurePreAdoptBackupHook();
  // Recording a promotion of a NEW digest snapshots the CURRENT (still-running) digest's state.
  recordApprovedPromotion(OTHER, "adopting new build", "admin-1", "2026-07-25T02:00:00.000Z");
  const stored = latestReleaseBackup();
  assert.ok(stored, "a pre-adopt backup was captured by the promotion hook");
  assert.equal(stored?.digest, D); // tagged with the outgoing (rollback-target) digest, not the promoted one
});
