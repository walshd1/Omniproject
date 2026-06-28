import { createHmac } from "node:crypto";
import { currentVersion, derivedKey } from "./key-registry";

/**
 * Per-session broker signing key.
 *
 * The key used to sign a gateway→broker request is NOT the static env master — it
 * is DERIVED, per session, as:
 *
 *     sessionBrokerKey = HMAC( derivedKey("broker", v),  sub ‖ smono ‖ salt )
 *
 *   - `derivedKey("broker", v)` = HMAC(env master, "broker:vN"). Only our system
 *     holds the master, so a signature that verifies under this key PROVES the
 *     request originated from our gateway — and rolls forward on key revocation.
 *   - `sub ‖ smono ‖ salt` binds the key to one USER and one SESSION:
 *       · sub   — the acting username/subject.
 *       · smono — the monotonic-clock reading at session creation (a non-rewindable
 *                 "session start time"; ordering is guaranteed within a replica).
 *       · salt  — CSPRNG entropy minted once per session, so the key is regenerated
 *                 from fresh entropy on every login and stays unique even across a
 *                 process restart that resets the monotonic clock.
 *
 * The key itself NEVER leaves the gateway. We sign each request with it and transmit
 * only the (non-secret) binding material — sub, smono, salt, broker-key version — so
 * the broker re-derives the same key from ITS copy of the master and verifies. An
 * observer who captures the binding material still cannot forge a signature without
 * the master (HMAC), and a leaked session key is scoped to a single session.
 *
 * This is a shared-secret MAC, not a third-party signature: it authenticates to a
 * party that holds the master (the broker), proving valid origin + that a specific
 * user's valid session sent it. It does not provide non-repudiation against the
 * gateway itself (the same trust boundary as the existing PSK).
 */

/** The non-secret material needed to re-derive a session's broker key. */
export interface SessionBind {
  /** The acting subject (username) the key is bound to. */
  sub: string;
  /** Monotonic-clock reading (ns string) at session creation. */
  smono: string;
  /** Per-session CSPRNG entropy (hex). */
  salt: string;
  /** Broker-key version the session key was derived under (for revocation/rotation). */
  bkver?: number;
}

/** Derive the per-session broker signing key (hex) from its binding material. */
export function deriveSessionBrokerKey(bind: SessionBind): string {
  const version = bind.bkver ?? currentVersion("broker");
  const master = derivedKey("broker", version);
  return createHmac("sha256", master).update(`${bind.sub}\n${bind.smono}\n${bind.salt}`).digest("hex");
}

/** Pull the binding material off a session, or null when it predates the scheme
 *  (older cookie, or a system/unauthenticated call) — callers fall back to the
 *  static broker key in that case. */
export function sessionBindFromSession(
  session: { sub?: string; smono?: string; salt?: string } | null | undefined,
): SessionBind | null {
  if (!session?.sub || !session.smono || !session.salt) return null;
  return { sub: session.sub, smono: session.smono, salt: session.salt };
}
