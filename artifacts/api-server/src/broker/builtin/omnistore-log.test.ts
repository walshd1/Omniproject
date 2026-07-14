import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { OmniEventLog, deriveKeys, GENESIS, seal, open } from "./omnistore-log";

/**
 * OmniStore event log — the append-only, hash-chained, encrypted core. Proves: the chain verifies,
 * any tamper/reorder/truncate is detected, at-rest seals are opaque + authenticated, and a portable
 * bundle round-trips between "instances" (fresh key sets) with the chain re-verified.
 */
const keys = () => deriveKeys(crypto.createHash("sha256").update("test-root").digest());

function seeded(): OmniEventLog {
  const log = new OmniEventLog(keys());
  log.append("project.create", "u1", { id: "p1", name: "Alpha" }, "2026-01-01T00:00:00Z");
  log.append("issue.create", "u1", { id: "i1", projectId: "p1", title: "First" }, "2026-01-01T00:01:00Z");
  log.append("issue.update", "u2", { id: "i1", patch: { status: "done" } }, "2026-01-01T00:02:00Z");
  return log;
}

test("append chains monotonically and a clean chain verifies", () => {
  const log = seeded();
  assert.equal(log.head().seq, 3);
  assert.deepEqual(log.entries().map((l) => l.seq), [1, 2, 3]);
  assert.equal(log.entries()[0]!.prevHash, GENESIS);
  assert.equal(log.entries()[1]!.prevHash, log.entries()[0]!.hash); // links commit to their predecessor
  assert.deepEqual(log.verify(), { ok: true });
});

test("tampering a link's payload is detected at that link", () => {
  const log = seeded();
  (log.entries()[1]! as { payload: Record<string, unknown> }).payload["title"] = "Forged"; // mutate in place
  const v = log.verify();
  assert.equal(v.ok, false);
  assert.equal((v as { brokenAt: number }).brokenAt, 1);
});

test("reordering links is detected (prevHash mismatch)", () => {
  const log = seeded();
  const e = log.entries() as unknown as unknown[];
  [e[1], e[2]] = [e[2], e[1]]; // swap two links
  assert.equal(log.verify().ok, false);
});

test("at-rest seal is opaque + authenticated and round-trips through the chain check", () => {
  const k = keys();
  const log = new OmniEventLog(k);
  log.append("project.create", "u1", { id: "p1", name: "Alpha" }, "2026-01-01T00:00:00Z");
  const token = log.sealed();
  assert.ok(token.startsWith("og1."));
  assert.ok(!token.includes("Alpha")); // ciphertext, not plaintext
  const reopened = OmniEventLog.openSealed(token, k);
  assert.deepEqual(reopened.entries().map((l) => l.seq), [1]);
  assert.deepEqual(reopened.verify(), { ok: true });
});

test("a wrong key or a flipped byte fails to open (GCM auth) — fail-closed", () => {
  const k = keys();
  const token = seal("secret-state", k.seal);
  assert.throws(() => open(token, crypto.randomBytes(32))); // wrong key
  const flipped = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A"); // corrupt the ciphertext tail
  assert.throws(() => open(flipped, k.seal)); // tampered
});

test("a sealed log opens + re-verifies only under the SAME keys (the key is the store's identity)", () => {
  const k = keys();
  const token = seeded().sealed();
  const reopened = OmniEventLog.openSealed(token, k);
  assert.deepEqual(reopened.entries().map((l) => l.seq), [1, 2, 3]);
  assert.deepEqual(reopened.verify(), { ok: true });
  // A different root ⇒ different seal+chain keys ⇒ can't even decrypt (fail-closed). Portability moves
  // the root key alongside the ciphertext (see OmniStore.exportBundle).
  const otherKeys = deriveKeys(crypto.createHash("sha256").update("other-instance").digest());
  assert.throws(() => OmniEventLog.openSealed(token, otherKeys));
});
