import { clearBrokerLog } from "./broker-log";
import { getReadCache } from "./read-cache";
import { zeroizeKeyCaches } from "./crypto-keys";
import { zeroizeKmsKeys } from "./kms";

/**
 * Full active memory cleanse on shutdown.
 *
 * Two kinds of clearing, honestly scoped:
 *  1. REFERENCE clearing (GC-eligible) for the bounded in-memory working sets — the broker-log ring
 *     and the optional read cache. JavaScript strings are immutable and GC'd, so this is a tidy
 *     drop, not byte-zeroisation; the real protection there is the stateless design (no long-lived
 *     secrets sit in server-side structures — sessions live in the client cookie, access tokens are
 *     per-request).
 *  2. ACTIVE byte-ZEROISATION for the one class that CAN be scrubbed: raw key material held in
 *     Buffers. `Buffer.fill(0)` overwrites the actual bytes, so the KMS-unwrapped root keys
 *     (config-at-rest + vault) and every derived AES key are wiped from memory before exit — a
 *     memory image / core dump captured after a graceful shutdown yields no usable key.
 *
 * The OS reclaims the whole process's memory on exit regardless; this narrows the window where a
 * live-but-shutting-down process still holds recoverable keys (assume-breach: minimise blast radius).
 */
export function wipeInMemoryState(): void {
  // 1. Drop the bounded working sets.
  clearBrokerLog();
  getReadCache().clear();
  // 2. Actively zeroise the raw key material (root keys first — the crown jewels).
  zeroizeKmsKeys();
  zeroizeKeyCaches();
}
