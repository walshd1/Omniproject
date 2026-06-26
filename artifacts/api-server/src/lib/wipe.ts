import { clearBrokerLog } from "./broker-log";
import { getReadCache } from "./read-cache";

/**
 * Drop the gateway's bounded in-memory working sets on shutdown.
 *
 * Honest scope: JavaScript is garbage-collected and strings are immutable, so
 * this **clears references** (making the data eligible for GC and tidying a
 * graceful shutdown) — it is NOT secure byte-zeroisation (only Buffers can be
 * zeroed; the OS reclaims the whole process's memory on exit anyway). The real
 * protection is the stateless design: no long-lived secrets sit in server-side
 * structures (sessions live in the client cookie; access tokens are per-request
 * and GC'd; the broker log holds only a redacted projection).
 *
 * What it clears: the broker-log ring and the optional read cache.
 */
export function wipeInMemoryState(): void {
  clearBrokerLog();
  getReadCache().clear();
}
