import { createHmac } from "node:crypto";
import { constantTimeEqual } from "./crypto-keys";
import { derivedKey, currentVersion } from "./key-registry";
import { canonical } from "./provenance";
import { signMessage, publicKeyId, verifySignature } from "./signing";
import { logger } from "./logger";
import { SealedFile, resolveConfigFile } from "./sealed-file";
import { sharedKv, sharedStateMode } from "./shared-state";
import { safeParseJson } from "./safe-json";
import { getSettings } from "./settings";
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

// ── Local EVIDENCE log (roadmap X.14 — "loss/transfer must not lose the chain of evidence") ─────────
// The head alone proves continuity but carries no evidence. So the sealed EVENTS are also retained at rest
// (AES-256-GCM `SealedFile`, RAM-only when no config dir is set — same posture as every other sealed store),
// bounded by the `historyRetention.retentionDays` disposal window (+ a hard count cap so the file/backup can't
// grow unbounded), and carried in the ENCRYPTED backup. So an encrypted backup + the keys reconstitute the
// whole tamper-evident chain AND its events, with no external SIEM required. Writes are debounced (coalesced)
// to avoid rewriting a growing sealed file on every event; `flushAuditLog()` forces a synchronous write (used
// by the backup export + tests). The external SIEM stays the durable system of record; this is the portable copy.
const MAX_LOG_EVENTS = 200_000;
const LOG_FLUSH_MS = 1000;
let logEvents: SealedAuditEvent[] = [];
let logLoaded = false;
let logDirty = false;
let logFlushTimer: ReturnType<typeof setTimeout> | null = null;
const logStore = new SealedFile(() => resolveConfigFile("AUDIT_LOG_FILE", "audit-log.json"), "audit log");

function ensureLogLoaded(): void {
  if (logLoaded) return;
  logStore.loadOnce((raw) => {
    const parsed = safeParseJson<SealedAuditEvent[]>(raw);
    if (Array.isArray(parsed)) logEvents = parsed;
  });
  logLoaded = true;
}

/** Drop events past the retention window (`historyRetention.retentionDays`; null/≤0 ⇒ keep forever) and, as a
 *  hard backstop regardless of time, cap the total count so the sealed file + every backup stay bounded. */
function pruneLog(): void {
  const days = getSettings().historyRetention?.retentionDays;
  if (typeof days === "number" && days > 0) {
    const min = Date.now() - days * 24 * 60 * 60 * 1000;
    logEvents = logEvents.filter((e) => { const t = Date.parse(e.ts); return Number.isNaN(t) || t >= min; });
  }
  if (logEvents.length > MAX_LOG_EVENTS) logEvents = logEvents.slice(-MAX_LOG_EVENTS);
}

/** Force a synchronous prune + seal-to-disk of the evidence log (backup export + tests + shutdown). */
export function flushAuditLog(): void {
  if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  if (!logDirty) return;
  pruneLog();
  logStore.write(JSON.stringify(logEvents));
  logDirty = false;
}

function scheduleLogFlush(): void {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => { logFlushTimer = null; flushAuditLog(); }, LOG_FLUSH_MS);
  if (typeof logFlushTimer.unref === "function") logFlushTimer.unref();
}

/** Append a freshly-sealed event to the local evidence log (debounced write). */
function recordToLog(ev: SealedAuditEvent): void {
  ensureLogLoaded();
  logEvents.push(ev);
  if (logEvents.length > MAX_LOG_EVENTS) logEvents = logEvents.slice(-MAX_LOG_EVENTS);
  logDirty = true;
  scheduleLogFlush();
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
  const sealed: SealedAuditEvent = { ...ev, seal: { seq, prevHash, hash, kv: version } };
  recordToLog(sealed);
  return sealed;
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
  // The head is fleet-shared (Redis, written by another replica) — validate its TYPES before it drives
  // linkHash/CAS, mirroring the disk path's guard (ensureLoaded). A wrong-typed head would corrupt the
  // chain link or the compare-and-set. Fail CLOSED (throw) rather than reset to genesis, which would
  // fork the chain: the caller's CAS loop surfaces the error and an operator investigates.
  const p = safeParseJson<Head>(raw); // cross-replica shared head — strip dangerous keys before validating
  if (typeof p?.seq !== "number" || !Number.isFinite(p.seq) || typeof p?.lastHash !== "string") {
    throw new Error("audit chain: shared head is malformed");
  }
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
    if (won) { const sealed: SealedAuditEvent = { ...ev, seal: { seq, prevHash, hash, kv: version } }; recordToLog(sealed); return sealed; }
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
    // Constant-time MAC comparison: `seal.hash` is caller-supplied and `linkHash` is the secret keyed
    // HMAC recomputed for it, so a short-circuiting `!==` would leak, byte-by-byte, how much of a guessed
    // hash is correct — a timing oracle that could let a holder of the (attacker-altered) SIEM copy forge
    // a valid chain link WITHOUT the audit key, defeating this module's tamper-evidence guarantee. Matches
    // the constant-time check the provenance chain already uses.
    if (!constantTimeEqual(linkHash(seal.seq, seal.prevHash, ev, seal.kv), seal.hash)) return { ok: false, count: events.length, brokenAt: i, reason: "hash mismatch (event altered)" };
    prev = seal.hash;
    expectedSeq = seal.seq + 1;
  }
  return { ok: true, count: events.length, brokenAt: null };
}

/**
 * BACKUP export/import (roadmap X.14). The audit-chain store persists only the chain HEAD ({seq, lastHash}) —
 * the events themselves live in the external SIEM. Carrying the head in the ENCRYPTED backup lets a migrated
 * instance CONTINUE the same tamper-evident chain (with the same key material the seals still verify across the
 * boundary) instead of resetting to genesis and reusing seqs. Sealed-backup only (an audit position is
 * sensitive). Single-replica / SealedFile head; in Redis fleet mode the authoritative head lives in shared
 * state and travels with Redis.
 */
export interface AuditChainExport { seq: number; lastHash: string }

export function exportAuditChain(): AuditChainExport {
  ensureLoaded();
  return { seq: head.seq, lastHash: head.lastHash };
}

/**
 * Restore the chain head from a backup — ADVANCE-ONLY. The audit position is monotonic by design, so a restore
 * must never REWIND it (that would let already-issued seqs be reused / the chain fork). A fresh migration
 * target is at genesis, so it advances to the backup's head; restoring an older backup onto a live instance
 * KEEPS the live (higher) head. Returns whether it applied, with a reason when it didn't.
 */
export function importAuditChain(data: unknown): { applied: boolean; reason?: string } {
  ensureLoaded();
  const d = (data ?? {}) as Partial<AuditChainExport>;
  if (typeof d.seq !== "number" || !Number.isFinite(d.seq) || d.seq < 0 || typeof d.lastHash !== "string" || !d.lastHash) {
    return { applied: false, reason: "malformed audit-chain head" };
  }
  const seq = Math.floor(d.seq);
  if (seq < head.seq) return { applied: false, reason: `kept live head seq ${head.seq} (backup's ${seq} is older — audit position never rewinds)` };
  head = { seq, lastHash: d.lastHash };
  persistHead();
  return { applied: true };
}

/** Status of the sealed evidence log for the security admin: how many events are retained, the disposal
 *  window, the span, whether the log is DURABLE (a config dir is set — else RAM-only), and the hard cap. */
export function auditLogStatus(): { retained: number; retentionDays: number | null; oldest: string | null; newest: string | null; durable: boolean; cap: number } {
  ensureLogLoaded();
  const days = getSettings().historyRetention?.retentionDays;
  return {
    retained: logEvents.length,
    retentionDays: typeof days === "number" && days > 0 ? days : null,
    oldest: logEvents[0]?.ts ?? null,
    newest: logEvents[logEvents.length - 1]?.ts ?? null,
    durable: resolveConfigFile("AUDIT_LOG_FILE", "audit-log.json") != null,
    cap: MAX_LOG_EVENTS,
  };
}

/** Actively enforce the retention window NOW: prune events past `historyRetention.retentionDays` + the hard
 *  cap, persist, and report how many were disposed. Called by the security admin action + the /history/dispose
 *  job so retention is enforced actively, not only lazily on read/flush. */
export function disposeAuditLog(): { disposed: number; remaining: number } {
  ensureLogLoaded();
  const before = logEvents.length;
  pruneLog();
  logDirty = true;
  flushAuditLog();
  return { disposed: before - logEvents.length, remaining: logEvents.length };
}

/** DSAR support: a CONTENT-FREE count of retained evidence events whose actor matches a subject predicate
 *  (plus the total retained). Never returns event bodies — the caller reports counts + the retention basis,
 *  the same content-free posture as the provenance ring. */
export function auditLogSubjectRefs(matchesActor: (actor: SealedAuditEvent["actor"]) => boolean): { retained: number; total: number } {
  ensureLogLoaded();
  return { retained: logEvents.filter((e) => matchesActor(e.actor ?? null)).length, total: logEvents.length };
}

/** The retained evidence log (sealed events), pruned + flushed so a backup captures the current bounded set. */
export function exportAuditLog(): SealedAuditEvent[] {
  ensureLogLoaded();
  flushAuditLog();      // prune + persist so the export matches disk
  return logEvents.slice();
}

/**
 * Restore the evidence log from a backup. The events are FIRST re-verified as an intact chain
 * (`verifyAuditChain`) — a tampered/broken log is refused, never written. ADVANCE-ONLY, like the head: a
 * restore replaces the local log only when its tip seq is ≥ the live tip (a fresh migration target advances;
 * restoring an older backup onto a live instance keeps the live evidence). When it advances, the head is moved
 * to the log's tip too, so head + log stay consistent.
 */
export function importAuditLog(data: unknown): { applied: boolean; count: number; reason?: string } {
  ensureLoaded();
  ensureLogLoaded();
  if (!Array.isArray(data)) return { applied: false, count: 0, reason: "audit log is not an array" };
  const evs = data as SealedAuditEvent[];
  const verdict = verifyAuditChain(evs);
  if (!verdict.ok) return { applied: false, count: 0, reason: `chain invalid at index ${verdict.brokenAt}: ${verdict.reason}` };
  const tipSeq = evs.length ? evs[evs.length - 1]!.seal.seq : 0;
  const liveTip = logEvents.length ? logEvents[logEvents.length - 1]!.seal.seq : head.seq;
  if (tipSeq < liveTip) return { applied: false, count: 0, reason: `kept live evidence log (tip ${liveTip} newer than backup ${tipSeq})` };
  logEvents = evs.slice();
  logDirty = true;
  flushAuditLog();
  if (evs.length) head = { seq: evs[evs.length - 1]!.seal.seq, lastHash: evs[evs.length - 1]!.seal.hash };
  persistHead();
  return { applied: true, count: logEvents.length };
}

/** Test-only: reset the in-memory head (and the shared head key) + the evidence log. */
export function __resetAuditChain(): void {
  head = { seq: 0, lastHash: GENESIS };
  store.reset();
  void sharedKv.del(SHARED_HEAD_KEY);
  logEvents = [];
  logLoaded = false;
  logDirty = false;
  if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  logStore.reset();
}
