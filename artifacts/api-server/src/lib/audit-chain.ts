import { createHmac } from "node:crypto";
import { derivedKey, currentVersion } from "./key-registry";
import { canonical } from "./provenance";
import { logger } from "./logger";
import { SealedFile, resolveConfigFile } from "./sealed-file";
import type { AuditEvent } from "./audit";

/**
 * Tamper-evident audit trail. Every recorded audit event is sealed into an append-only,
 * keyed HASH CHAIN: each link carries a monotonic `seq`, the `prevHash` of the link before
 * it, and a `hash = HMAC(auditKey, seq | prevHash | canonical(event))`.
 *
 *  - Hash-chained ⇒ removing or reordering any event breaks every later link (WORM-style).
 *  - Keyed (HMAC, not bare SHA) ⇒ an attacker who alters the SIEM copy cannot recompute a
 *    valid chain without the audit key, so tampering is DETECTABLE, not silently repairable.
 *  - The key is derived + versioned via the key registry (domain "audit"), so it rotates and
 *    revokes like the broker/provenance keys.
 *
 * The sealed fields ride on each event into stdout/the SIEM, so the external copy is
 * self-verifying. The chain HEAD (seq + lastHash) is held in memory and, when
 * AUDIT_CHAIN_FILE is set, persisted SEALED so the chain continues across a restart.
 *
 * HONEST SCOPE: this proves integrity to a holder of the audit key (the deployment). It is
 * tamper-EVIDENT, not non-repudiation against the gateway itself (that needs asymmetric
 * signing) — and the durable record lives in the external sink, not here.
 */
export interface AuditSeal {
  seq: number;
  prevHash: string;
  hash: string;
  /** Audit key version that produced `hash` (for rotation-aware verification). */
  kv: number;
}

export type SealedAuditEvent = AuditEvent & { seal: AuditSeal };

const GENESIS = "0".repeat(64);

function linkHash(seq: number, prevHash: string, ev: AuditEvent, version: number): string {
  // The event is canonicalised WITHOUT any existing seal so the MAC is stable + reproducible.
  const { seal: _omit, ...bare } = ev as SealedAuditEvent;
  return createHmac("sha256", derivedKey("audit", version))
    .update(`${seq}|${prevHash}|${canonical(bare)}`)
    .digest("hex");
}

// ── Chain head (in-memory; optionally persisted sealed) ─────────────────────────
interface Head { seq: number; lastHash: string }
let head: Head = { seq: 0, lastHash: GENESIS };
const store = new SealedFile(() => resolveConfigFile("AUDIT_CHAIN_FILE"), "audit chain");

function ensureLoaded(): void {
  store.loadOnce((raw) => {
    const parsed = JSON.parse(raw) as Head;
    if (typeof parsed.seq === "number" && typeof parsed.lastHash === "string") head = parsed;
    logger.info({ seq: head.seq }, "audit chain: head restored");
  });
}

function persistHead(): void {
  store.write(JSON.stringify(head));
}

/** Seal an event into the chain: advances the head and returns the event with its seal. */
export function sealAuditEvent(ev: AuditEvent): SealedAuditEvent {
  ensureLoaded();
  const version = currentVersion("audit");
  const seq = head.seq + 1;
  const prevHash = head.lastHash;
  const hash = linkHash(seq, prevHash, ev, version);
  head = { seq, lastHash: hash };
  persistHead();
  return { ...ev, seal: { seq, prevHash, hash, kv: version } };
}

/** The current chain anchor — what an external verifier checks the tip against. */
export function auditAnchor(): { seq: number; lastHash: string; algorithm: string; keyVersion: number } {
  ensureLoaded();
  return { seq: head.seq, lastHash: head.lastHash, algorithm: "HMAC-SHA256/chain", keyVersion: currentVersion("audit") };
}

export interface ChainVerdict { ok: boolean; count: number; brokenAt: number | null; reason?: string }

/**
 * Verify an ordered list of sealed audit events. Recomputes each link's hash with the key
 * version it claims and checks the prevHash linkage + monotonic seq. Pure — an offline
 * auditor can run the same check over the SIEM export. `expectedFirstPrev` defaults to the
 * genesis hash; pass a known anchor to verify a slice continues from it.
 */
export function verifyAuditChain(events: SealedAuditEvent[], expectedFirstPrev: string = GENESIS): ChainVerdict {
  let prev = expectedFirstPrev;
  let expectedSeq: number | null = null;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const seal = ev.seal;
    if (!seal) return { ok: false, count: events.length, brokenAt: i, reason: "missing seal" };
    if (expectedSeq !== null && seal.seq !== expectedSeq) return { ok: false, count: events.length, brokenAt: i, reason: "non-monotonic seq" };
    if (seal.prevHash !== prev) return { ok: false, count: events.length, brokenAt: i, reason: "prevHash mismatch (event removed/reordered)" };
    if (linkHash(seal.seq, seal.prevHash, ev, seal.kv) !== seal.hash) return { ok: false, count: events.length, brokenAt: i, reason: "hash mismatch (event altered)" };
    prev = seal.hash;
    expectedSeq = seal.seq + 1;
  }
  return { ok: true, count: events.length, brokenAt: null };
}

/** Test-only: reset the in-memory head. */
export function __resetAuditChain(): void {
  head = { seq: 0, lastHash: GENESIS };
  store.reset();
}
