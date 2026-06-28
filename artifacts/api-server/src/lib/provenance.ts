import { createHmac, timingSafeEqual } from "node:crypto";
import { currentVersion, derivedKey, isActive } from "./key-registry";
import type { SessionBind } from "./session-key";

/**
 * Provenance chain — a keyed-MAC, hash-chained record of every broker call, holding
 * ONLY fingerprints, never content. Zero-at-rest is preserved: the request/response
 * bytes pass through the broker as they must; here we keep just `HMAC_k(content)`,
 * chained so the whole sequence is tamper-evident.
 *
 * Goal (per the design): provably state an action was initiated by actor X, that the
 * exact request and result are fingerprinted, ordered, and unaltered after the fact —
 * verified internally (no external clock/anchor needed: a monotonic counter + the hash
 * links order the chain; wall-clock is a human annotation). "Nothing changed" is proven
 * by RE-PRESENTING the content and recomputing the MAC — we never store the content to
 * reconstruct it.
 *
 * Key: PROVENANCE_KEY ?? BROKER_PSK ?? SESSION_SECRET (so the broker hop's MAC is the
 * same shared secret the broker can verify — see lib/broker-hmac).
 */
export type ProvenanceHop = "invoke" | "result" | "error";

export interface ProvenanceEntry {
  /** Correlation id grouping the hops of one logical call. */
  callId: string;
  /** Global monotonic sequence (orders the whole chain). */
  seq: number;
  hop: ProvenanceHop;
  /** The action name (e.g. "listProjects") — NOT its content. */
  action: string;
  /** The initiating actor (sub/email), or null. */
  actor: string | null;
  /** Monotonic clock reading for ordering (ns as string; never goes backwards). */
  tMono: string;
  /** Milliseconds elapsed since the chain started, by the internal monotonic clock.
   *  Relative offset (not wall time) — bound into the MAC so the timeline is part of
   *  the tamper-evidence: a mid-chain insert/reorder must reproduce a consistent
   *  sequence AND a plausible elapsed timeline, end to end. */
  elapsedMs: number;
  /** Wall-clock annotation (informational only; not in the MAC). */
  tWall: string;
  /** The provenance-key version this entry was signed under (for key revocation). */
  kver: number;
  /** HMAC over the canonicalised content + actor + seq (the fingerprint). */
  contentMac: string;
  /** Keyed fingerprint of the initiating SESSION (sub‖smono‖salt) — binds the entry to
   *  a session's cryptographic identity, not just the actor name, so forging "X's session
   *  did this" needs the provenance key (and matching the broker witness needs the broker
   *  master too). Null for system/unauthenticated calls. */
  sessionMac: string | null;
  /** The previous entry's `mac` (the chain link), or null for the first. */
  prevMac: string | null;
  /** HMAC over this entry's fields incl. prevMac (makes the chain tamper-evident). */
  mac: string;
}

/** HMAC under the provenance key of the given VERSION (so a revoked version can still
 *  be re-derived to verify history, while new entries sign under the current version). */
function hmac(input: string, version: number): string {
  return createHmac("sha256", derivedKey("provenance", version)).update(input).digest("hex");
}

/** Deterministic JSON: object keys sorted recursively, so the MAC is stable. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) out[k] = sortDeep((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

/** The fingerprint of some content, bound to the actor + sequence position. */
export function contentMac(content: unknown, actor: string | null, seq: number, version: number = currentVersion("provenance")): string {
  return hmac(`${seq}|${actor ?? ""}|${canonical(content)}`, version);
}

/** Keyed fingerprint of the initiating session — the SAME binding the broker key uses
 *  (sub‖smono‖salt), under the provenance key. Null when there is no session (system call),
 *  so unauthenticated entries bind a null marker exactly like a null actor. */
export function sessionMac(bind: SessionBind | null | undefined, version: number = currentVersion("provenance")): string | null {
  if (!bind) return null;
  return hmac(`${bind.sub}|${bind.smono}|${bind.salt}`, version);
}

function entryMac(e: Omit<ProvenanceEntry, "mac">): string {
  // Elapsed offset, key version AND the session fingerprint are in the MAC, so neither the
  // timeline, the signing key, nor the initiating session can be rewritten silently. A "|"
  // delimiter keeps fields unambiguous.
  return hmac([e.seq, e.prevMac ?? "", e.contentMac, e.sessionMac ?? "", e.tMono, e.elapsedMs, e.kver, e.actor ?? "", e.hop, e.action, e.callId].join("|"), e.kver);
}

const RING_MAX = 500;
const ring: ProvenanceEntry[] = [];
let seqCounter = 0;
let lastMac: string | null = null;
// The chain's start reading (monotonic), so each entry records ms elapsed since it.
let startMono: bigint | null = null;

/** Append one fingerprint to the chain and return the (content-free) entry. */
export function record(input: { callId: string; hop: ProvenanceHop; action: string; actor: string | null; content: unknown; sessionBind?: SessionBind | null }): ProvenanceEntry {
  const seq = seqCounter++;
  const now = process.hrtime.bigint();
  if (startMono === null) startMono = now;
  const kver = currentVersion("provenance");
  const cMac = contentMac(input.content, input.actor, seq, kver);
  const partial: Omit<ProvenanceEntry, "mac"> = {
    callId: input.callId,
    seq,
    hop: input.hop,
    action: input.action,
    actor: input.actor,
    tMono: now.toString(),
    elapsedMs: Number((now - startMono) / 1_000_000n),
    tWall: new Date().toISOString(),
    kver,
    contentMac: cMac,
    sessionMac: sessionMac(input.sessionBind, kver),
    prevMac: lastMac,
  };
  const mac = entryMac(partial);
  const entry: ProvenanceEntry = { ...partial, mac };
  lastMac = mac;
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  return entry;
}

/** Recent chain entries (optionally just one call's), oldest→newest. */
export function recentProvenance(callId?: string): ProvenanceEntry[] {
  return callId ? ring.filter((e) => e.callId === callId) : [...ring];
}

export interface ChainVerdict {
  ok: boolean;
  length: number;
  /** seq of the first entry that failed, if any. */
  brokenAt?: number;
  reason?: string;
  /** Key versions whose entries are present but REVOKED — integrity checks, but a leaked
   *  key could have forged them, so their guarantee is void (untrusted). */
  revokedKeyVersions?: number[];
}

const safeEq = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Verify a CONTIGUOUS slice of the chain: each entry's own MAC recomputes (so no field
 * was altered), the links join (prevMac === previous mac), and order is monotonic.
 */
export function verifyChain(entries: ProvenanceEntry[]): ChainVerdict {
  const revoked = new Set<number>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (!isActive("provenance", e.kver)) revoked.add(e.kver);
    if (!safeEq(entryMac(e), e.mac)) return { ok: false, length: entries.length, brokenAt: e.seq, reason: "entry MAC mismatch (a field was altered)" };
    if (i > 0) {
      const prev = entries[i - 1]!;
      if (e.prevMac !== prev.mac) return { ok: false, length: entries.length, brokenAt: e.seq, reason: "chain link broken" };
      // Sequence, monotonic reading AND elapsed offset must all advance.
      if (e.seq <= prev.seq || BigInt(e.tMono) < BigInt(prev.tMono) || e.elapsedMs < prev.elapsedMs) {
        return { ok: false, length: entries.length, brokenAt: e.seq, reason: "out-of-order entry" };
      }
    }
  }
  return { ok: true, length: entries.length, ...(revoked.size ? { revokedKeyVersions: [...revoked].sort((a, b) => a - b) } : {}) };
}

/** Prove "nothing changed": re-present content and confirm it matches the fingerprint. */
export function verifyContent(entry: ProvenanceEntry, content: unknown): boolean {
  return safeEq(contentMac(content, entry.actor, entry.seq, entry.kver), entry.contentMac);
}

/** Prove "this exact session initiated it": re-present the session binding and confirm it
 *  matches the entry's session fingerprint. A null binding matches a system-call entry. */
export function verifySession(entry: ProvenanceEntry, bind: SessionBind | null | undefined): boolean {
  const expected = sessionMac(bind, entry.kver);
  if (expected === null || entry.sessionMac === null) return expected === entry.sessionMac;
  return safeEq(expected, entry.sessionMac);
}

/** Test-only: reset the in-memory chain. */
export function __resetProvenance(): void {
  ring.length = 0;
  seqCounter = 0;
  lastMac = null;
  startMono = null;
}
