import { createHmac } from "node:crypto";
import { derivedKey, currentVersion } from "./key-registry";
import { canonical } from "./provenance";
import { signMessage, publicKeyId, verifySignature } from "./signing";
import { logger } from "./logger";
import { SealedFile, resolveConfigFile } from "./sealed-file";
import { sharedKv, sharedStateMode } from "./shared-state";
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

/** Seal an event into the chain: advances the head and returns the event with its seal.
 *  SYNC — the single-replica path (in-memory head, optionally SealedFile-persisted). This is
 *  the ONLY path when REDIS_URL is unset, and it is byte-identical to before this change. */
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

// ── Fleet-shared chain head (opt-in: only active when REDIS_URL ⇒ shared-state mode "redis") ──
// The head {seq,lastHash} lives at ONE shared key and advances by ATOMIC compare-and-set. Each
// seal reads the current head, computes its link against it, then CASes {expected: exact bytes
// read, next: new head}. Only one writer can win the transition from a given head value; every
// racing writer sees a different current value, so its CAS fails and it RETRIES against the new
// head. That makes advancement a single linear sequence across all replicas — the chain cannot
// fork. There is no ABA hazard because the compared value embeds a strictly increasing `seq`, so
// a head value never recurs.
const SHARED_HEAD_KEY = "audit:chain:head";
const MAX_CAS_ATTEMPTS = 64;

async function readSharedHead(): Promise<{ seq: number; lastHash: string; raw: string | null }> {
  const raw = await sharedKv.get(SHARED_HEAD_KEY);
  if (raw === null) return { seq: 0, lastHash: GENESIS, raw: null };
  const p = JSON.parse(raw) as Head;
  return { seq: p.seq, lastHash: p.lastHash, raw };
}

/**
 * Seal an event into the FLEET-shared chain. When shared-state is in-process (no REDIS_URL) this
 * is exactly the sync single-replica seal, so behaviour is unchanged. When Redis-backed, it
 * advances the one shared head via atomic CAS (retrying on a lost race) so replicas can't fork
 * the chain. Async because a correct cross-replica advance requires the CAS round-trip.
 */
export async function sealAuditEventShared(ev: AuditEvent): Promise<SealedAuditEvent> {
  if (sharedStateMode() !== "redis") return sealAuditEvent(ev);
  const version = currentVersion("audit");
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const cur = await readSharedHead();
    const seq = cur.seq + 1;
    const prevHash = cur.lastHash;
    const hash = linkHash(seq, prevHash, ev, version);
    const won = await sharedKv.cas(SHARED_HEAD_KEY, cur.raw, JSON.stringify({ seq, lastHash: hash } satisfies Head));
    if (won) return { ...ev, seal: { seq, prevHash, hash, kv: version } };
    // Lost the CAS: another replica advanced the head. Loop re-reads it and re-links.
  }
  // Extreme, sustained contention only. Surface it rather than risk an unlinked seal.
  throw new Error("audit chain: shared head CAS contention exceeded retry budget");
}

export interface AuditAnchor {
  seq: number;
  lastHash: string;
  algorithm: string;
  keyVersion: number;
  /** Non-repudiation layer (present only when Ed25519 signing is configured). */
  signatureAlgorithm?: "Ed25519";
  publicKeyId?: string;
  /** Base64 Ed25519 signature over `auditAnchorMessage(this)`. */
  signature?: string;
}

/** The exact, deterministic message that is signed for an anchor — the chain TIP bound to
 *  the key version. An offline verifier rebuilds this from the anchor's base fields. */
export function auditAnchorMessage(a: { seq: number; lastHash: string; algorithm: string; keyVersion: number }): string {
  return canonical({ seq: a.seq, lastHash: a.lastHash, algorithm: a.algorithm, keyVersion: a.keyVersion });
}

/** Wrap a chain tip in an anchor, adding the Ed25519 signature when asymmetric signing is on. */
function signAnchor(seq: number, lastHash: string): AuditAnchor {
  const base = { seq, lastHash, algorithm: "HMAC-SHA256/chain", keyVersion: currentVersion("audit") };
  const signature = signMessage(auditAnchorMessage(base));
  if (!signature) return base;
  const kid = publicKeyId();
  return { ...base, signatureAlgorithm: "Ed25519", signature, ...(kid ? { publicKeyId: kid } : {}) };
}

/** The current chain anchor — what an external verifier checks the tip against. When
 *  asymmetric signing is configured it also carries an Ed25519 signature over the tip,
 *  so the gateway non-repudiably attests to this position in the chain. */
export function auditAnchor(): AuditAnchor {
  ensureLoaded();
  return signAnchor(head.seq, head.lastHash);
}

/** The anchor over the FLEET-shared tip when Redis-backed, else the local {@link auditAnchor}.
 *  Use this where the anchor must reflect the whole fleet's chain, not one replica's head. */
export async function auditAnchorShared(): Promise<AuditAnchor> {
  if (sharedStateMode() !== "redis") return auditAnchor();
  const cur = await readSharedHead();
  return signAnchor(cur.seq, cur.lastHash);
}

/** Verify an anchor's Ed25519 signature against a published public key (PEM). False when the
 *  anchor is unsigned or the signature doesn't match — pure, for an offline auditor. */
export function verifyAuditAnchor(anchor: AuditAnchor, publicKeyPemStr: string): boolean {
  return anchor.signature ? verifySignature(auditAnchorMessage(anchor), anchor.signature, publicKeyPemStr) : false;
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

/** Test-only: reset the in-memory head (and the shared head key). */
export function __resetAuditChain(): void {
  head = { seq: 0, lastHash: GENESIS };
  store.reset();
  void sharedKv.del(SHARED_HEAD_KEY);
}
