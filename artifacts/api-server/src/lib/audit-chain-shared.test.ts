import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  sealAuditEvent,
  sealAuditEventShared,
  auditAnchor,
  auditAnchorShared,
  verifyAuditChain,
  __resetAuditChain,
  type SealedAuditEvent,
} from "./audit-chain";
import { recordAudit } from "./audit";
import { sharedKv, __resetSharedStateForTest, __setRedisKvForTest } from "./shared-state";
import { FakeRedis } from "../__tests__/fake-redis";
import type { AuditEvent } from "./audit";

/**
 * Fleet-shared audit chain (opt-in, REDIS_URL ⇒ shared-state "redis"): the head advances by
 * atomic CAS so replicas can't fork the chain. With no Redis, sealAuditEventShared IS the sync
 * single-replica seal (covered by audit-chain.test.ts). Here we drive the Redis-shaped path via
 * the FakeRedis double (atomic CAS Lua) — no live server in this env.
 */
afterEach(async () => { __resetAuditChain(); await sharedKv.clear(); __resetSharedStateForTest(); });

const ev = (action: string): AuditEvent => ({ ts: "2026-06-28T00:00:00Z", category: "admin", action, write: true });

test("in-process mode: the shared seal delegates to the sync seal (identical result)", async () => {
  // No Redis bound ⇒ mode is in-process. Two seals — one sync, one via the shared entry — chain.
  const a = sealAuditEvent(ev("a"));
  const b = await sealAuditEventShared(ev("b"));
  assert.equal(b.seal.seq, 2);
  assert.equal(b.seal.prevHash, a.seal.hash);
  assert.deepEqual(verifyAuditChain([a, b]), { ok: true, count: 2, brokenAt: null });
});

test("redis mode: sequential shared seals advance the ONE shared head and verify", async () => {
  __setRedisKvForTest(new FakeRedis());
  const a = await sealAuditEventShared(ev("a"));
  const b = await sealAuditEventShared(ev("b"));
  const c = await sealAuditEventShared(ev("c"));
  assert.deepEqual([a.seal.seq, b.seal.seq, c.seal.seq], [1, 2, 3]);
  assert.equal(b.seal.prevHash, a.seal.hash);
  assert.equal(c.seal.prevHash, b.seal.hash);
  assert.deepEqual(verifyAuditChain([a, b, c]), { ok: true, count: 3, brokenAt: null });
  // auditAnchorShared tracks the shared tip.
  const anchor = await auditAnchorShared();
  assert.equal(anchor.seq, 3);
  assert.equal(anchor.lastHash, c.seal.hash);
});

test("redis mode: CONCURRENT seals do not fork — unique seqs, one valid linear chain", async () => {
  __setRedisKvForTest(new FakeRedis());
  const N = 15; // stays well under the CAS retry budget even in full lock-step contention
  const sealed = await Promise.all(Array.from({ length: N }, (_, i) => sealAuditEventShared(ev(`e${i}`))));
  const seqs = sealed.map((s) => s.seal.seq).sort((a, b) => a - b);
  // Every seq 1..N appears exactly once → no two events claimed the same chain position.
  assert.deepEqual(seqs, Array.from({ length: N }, (_, i) => i + 1));
  // Re-ordered into seq order, the whole set is a single unbroken hash chain.
  const ordered = [...sealed].sort((a, b) => a.seal.seq - b.seal.seq);
  assert.deepEqual(verifyAuditChain(ordered), { ok: true, count: N, brokenAt: null });
  assert.equal((await auditAnchorShared()).seq, N);
});

test("redis mode: a tampered shared-chain event is still detected", async () => {
  __setRedisKvForTest(new FakeRedis());
  const a = await sealAuditEventShared(ev("a"));
  const b = await sealAuditEventShared(ev("b"));
  const tampered: SealedAuditEvent = { ...b, action: "b-altered" };
  const v = verifyAuditChain([a, tampered]);
  assert.equal(v.ok, false);
  assert.match(v.reason!, /altered/);
});

test("recordAudit in redis mode advances the shared chain (best-effort async)", async () => {
  __setRedisKvForTest(new FakeRedis());
  recordAudit(ev("admin.write")); // fire-and-forget shared seal under Redis
  // Let the async seal settle, then the shared anchor must reflect the advance.
  await new Promise((r) => setTimeout(r, 10));
  const anchor = await auditAnchorShared();
  assert.equal(anchor.seq, 1);
});

test("in-process auditAnchor is unaffected by the shared path when no Redis is bound", () => {
  sealAuditEvent(ev("a"));
  assert.equal(auditAnchor().seq, 1); // local head only
});
