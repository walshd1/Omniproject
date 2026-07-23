import crypto from "node:crypto";
import { canonicalJson } from "../../lib/canonical-json";
import { deriveKey, deriveKeyFromBytes, masterSecret, decodeKey32 } from "../../lib/crypto-keys";
import { chainLinkHash, verifyChainLink } from "../../lib/hmac-chain";
import { safeParseJson } from "../../lib/safe-json";

/**
 * OmniStore's append-only, hash-chained, encrypted event log — the ONE source of truth beneath the
 * store. It is the mechanism that makes OmniStore (the only stateful thing below the broker seam)
 * trustworthy:
 *
 *  - **Provably immutable except via valid calls.** The log is append-only; the only mutation path is
 *    `append()`, called by a validated store write. Every link carries `prevHash` + a keyed
 *    `hash = HMAC(chainKey, seq | prevHash | canonical(event))`, so any at-rest edit, reorder,
 *    insertion or truncation breaks the chain and `verify()` pinpoints it. State is a pure fold of the
 *    log (see projection) — you cannot change state without appending a valid, chained event.
 *  - **Encrypted at rest / in transit.** Persisted + exported blobs are AES-256-GCM sealed (authenticated
 *    encryption), so the bytes are opaque and tamper-evident even before the chain check.
 *  - **Self-contained + portable.** The sealed log IS the whole store. `exportBundle()` produces a
 *    portable `{ bundle, exportKey }` a sibling OmniProject instance imports (chain re-verified) — the
 *    store moves between instances with no dependency on either gateway's key management.
 *
 * OmniStore owns its key (`OMNISTORE_KEY`, else derived from the master) — it does not lean on the
 * gateway's config-at-rest key, keeping it self-contained.
 */

export interface OmniEvent {
  /** 1-based, contiguous, monotonic — the chain position. */
  seq: number;
  /** ISO timestamp, STORED so a replay is exact and portable (never regenerated). */
  ts: string;
  /** e.g. "project.create" | "issue.update" | "issue.delete". */
  action: string;
  /** Who caused it (sub/email), for the audit trail. Null for system. */
  actor: string | null;
  /** The event body — resolved values, so applying it on replay is a deterministic assign. */
  payload: Record<string, unknown>;
}

export interface OmniLink extends OmniEvent {
  prevHash: string;
  hash: string;
}

/** The chain root — a fixed, well-known anchor the first link commits to. */
export const GENESIS = "omnistore:genesis";

/** Resolve OmniStore's root key: an explicit `OMNISTORE_KEY` (base64, 32 bytes) or, absent that, a
 *  domain-separated derivation from the deployment master. Injectable for tests/portability. */
export function resolveStoreKey(): Buffer {
  const raw = process.env["OMNISTORE_KEY"]?.trim();
  const decoded = raw ? decodeKey32(raw) : null;
  if (decoded) return decoded;
  return deriveKey(masterSecret({ dev: "omnistore-dev-master" }), "omnistore:root");
}

/** The two domain-separated sub-keys derived from a root: one for the chain HMAC, one for AES-GCM. */
export interface OmniKeys { chain: Buffer; seal: Buffer }
export function deriveKeys(root: Buffer = resolveStoreKey()): OmniKeys {
  return { chain: deriveKeyFromBytes(root, "omnistore:chain"), seal: deriveKeyFromBytes(root, "omnistore:seal") };
}

/** The canonical, seal-free bytes of an event — the stable body the link hash is computed over. */
function canonicalEvent(ev: OmniEvent): string {
  return canonicalJson({ seq: ev.seq, ts: ev.ts, action: ev.action, actor: ev.actor, payload: ev.payload });
}

/** Keyed hash of a link — HMAC over the canonical event bound to its seq + predecessor's hash. Shares the
 *  chain-link formula with the audit chain (lib/hmac-chain) so the two on-disk wire formats can't drift. */
export function linkHash(ev: OmniEvent, prevHash: string, chainKey: Buffer): string {
  return chainLinkHash(chainKey, ev.seq, prevHash, canonicalEvent(ev));
}

/** AES-256-GCM authenticated encryption — opaque + tamper-evident bytes at rest / in transit. */
export function seal(plaintext: string, sealKey: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sealKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `og1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

/** Reverse of {@link seal}; throws on a wrong key or a tampered blob (GCM auth failure). */
export function open(token: string, sealKey: Buffer): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "og1") throw new Error("omnistore: malformed sealed blob");
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const enc = Buffer.from(parts[3]!, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", sealKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export type VerifyResult = { ok: true } | { ok: false; brokenAt: number; reason: string };

/** The append-only hash-chained log. */
export class OmniEventLog {
  private links: OmniLink[] = [];
  private readonly keys: OmniKeys;

  constructor(keys: OmniKeys = deriveKeys()) { this.keys = keys; }

  /** The chain head — the seq + hash the next link commits to (GENESIS when empty). */
  head(): { seq: number; hash: string } {
    const last = this.links[this.links.length - 1];
    return last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS };
  }

  /** THE ONLY mutation path — append a validated event, chained onto the current head. */
  append(action: string, actor: string | null, payload: Record<string, unknown>, ts: string): OmniLink {
    const { seq: prevSeq, hash: prevHash } = this.head();
    const ev: OmniEvent = { seq: prevSeq + 1, ts, action, actor, payload };
    const hash = linkHash(ev, prevHash, this.keys.chain);
    const link: OmniLink = { ...ev, prevHash, hash };
    this.links.push(link);
    return link;
  }

  /** The chain, in order (for replay/export). */
  entries(): readonly OmniLink[] { return this.links; }

  /**
   * Re-walk the chain and prove it is intact: contiguous seq 1..n, each link commits to its
   * predecessor's hash (first to GENESIS), and every `hash` recomputes. Any tamper/reorder/insert/
   * truncate is caught with the offending index. This is the "provably immutable" guarantee.
   */
  verify(): VerifyResult {
    let prevHash = GENESIS;
    for (let i = 0; i < this.links.length; i++) {
      const l = this.links[i]!;
      if (l.seq !== i + 1) return { ok: false, brokenAt: i, reason: "non-contiguous seq" };
      if (l.prevHash !== prevHash) return { ok: false, brokenAt: i, reason: "prevHash mismatch (reorder/insert)" };
      // Constant-time MAC compare (shared with the audit chain): `l.hash` is attacker-controllable in a
      // tampered at-rest log, so a short-circuiting `!==` would be a byte-by-byte timing oracle for forging
      // a valid link without the chain key. Matches audit-chain.verifyAuditChain's rationale.
      if (!verifyChainLink(this.keys.chain, l.seq, prevHash, canonicalEvent(l), l.hash)) return { ok: false, brokenAt: i, reason: "hash mismatch (tampered)" };
      prevHash = l.hash;
    }
    return { ok: true };
  }

  /** Seal the whole log at rest under the store's own seal key. */
  sealed(): string { return seal(canonicalJson(this.links), this.keys.seal); }

  /**
   * Load a sealed log under the given keys: decrypt, parse (prototype-pollution-safe), and VERIFY the
   * chain — fail-closed (never accept a broken chain as if valid). The chain HMAC is keyed, so the
   * SAME keys that sealed it must open it: the store's key is its identity and travels with it (a
   * portable move carries the sealed log + the root key — see OmniStore.exportBundle).
   */
  static openSealed(token: string, keys: OmniKeys): OmniEventLog {
    const links = safeParseJson<OmniLink[]>(open(token, keys.seal));
    if (!Array.isArray(links)) throw new Error("omnistore: log is malformed");
    const log = new OmniEventLog(keys);
    log.links = links;
    const v = log.verify();
    if (!v.ok) throw new Error(`omnistore: integrity check failed at link #${v.brokenAt} (${v.reason})`);
    return log;
  }
}
