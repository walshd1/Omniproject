import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sealAuditEvent, verifyAuditChain, auditAnchor, __resetAuditChain, type SealedAuditEvent } from "./audit-chain";
import type { AuditEvent } from "./audit";

/**
 * Tamper-evident audit chain: hash-chained + keyed, so removing/reordering/altering any
 * event is detectable.
 */
afterEach(() => __resetAuditChain());

const ev = (action: string): AuditEvent => ({ ts: "2026-06-28T00:00:00Z", category: "admin", action, write: true });

test("a freshly sealed run verifies and advances seq + links each event", () => {
  const a = sealAuditEvent(ev("a"));
  const b = sealAuditEvent(ev("b"));
  const c = sealAuditEvent(ev("c"));
  assert.deepEqual([a.seal.seq, b.seal.seq, c.seal.seq], [1, 2, 3]);
  assert.equal(b.seal.prevHash, a.seal.hash); // chained
  assert.equal(c.seal.prevHash, b.seal.hash);
  assert.deepEqual(verifyAuditChain([a, b, c]), { ok: true, count: 3, brokenAt: null });
});

test("the anchor tracks the tip", () => {
  sealAuditEvent(ev("a"));
  const b = sealAuditEvent(ev("b"));
  const anchor = auditAnchor();
  assert.equal(anchor.seq, 2);
  assert.equal(anchor.lastHash, b.seal.hash);
});

test("altering an event's content is detected (hash mismatch)", () => {
  const a = sealAuditEvent(ev("a"));
  const b = sealAuditEvent(ev("b"));
  const tampered: SealedAuditEvent = { ...b, action: "b-altered" }; // same seal, changed body
  const v = verifyAuditChain([a, tampered]);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 1);
  assert.match(v.reason!, /altered/);
});

test("removing a middle event is detected (prevHash mismatch)", () => {
  const a = sealAuditEvent(ev("a"));
  sealAuditEvent(ev("b")); // dropped from the slice
  const c = sealAuditEvent(ev("c"));
  const v = verifyAuditChain([a, c]);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 1);
  assert.match(v.reason!, /seq|removed|reordered/); // gap detected (seq jump or prevHash break)
});

test("reordering events is detected", () => {
  const a = sealAuditEvent(ev("a"));
  const b = sealAuditEvent(ev("b"));
  const v = verifyAuditChain([b, a]);
  assert.equal(v.ok, false);
});

test("a slice can be verified from a known anchor (expectedFirstPrev)", () => {
  sealAuditEvent(ev("a"));
  const anchorAfterA = auditAnchor().lastHash;
  const b = sealAuditEvent(ev("b"));
  const c = sealAuditEvent(ev("c"));
  assert.deepEqual(verifyAuditChain([b, c], anchorAfterA), { ok: true, count: 2, brokenAt: null });
  // Wrong anchor → fails at the first link.
  assert.equal(verifyAuditChain([b, c], "deadbeef").ok, false);
});
