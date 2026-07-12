import { logger } from "../../lib/logger";
import { BuiltinBroker } from "./builtin-broker";
import { MemoryStore } from "./store";

/**
 * The built-in broker — selection + store wiring. Opt-in via `BUILTIN_BROKER`; off by default so the
 * stateless overlay / demo stays the default. The value chooses the backing store:
 *   - `memory` (or any truthy value, for now): in-process, non-persistent — tests / ephemeral use.
 *   - `postgres`: a durable, customer-owned store over `@workspace/db` — the real system of record
 *     (follow-up; falls back to memory with a loud warning until it ships, so a mis-set value can
 *     never silently corrupt or drop data by pretending to persist).
 */
export function builtinBrokerEnabled(): boolean {
  const raw = process.env["BUILTIN_BROKER"]?.trim().toLowerCase();
  return !!raw && raw !== "0" && raw !== "false" && raw !== "off";
}

/** Build the built-in broker for the configured store (memory today; Postgres next), warning if an
 *  as-yet-unavailable store was requested so it can never silently pretend to persist. */
export function makeBuiltinBroker(): BuiltinBroker {
  const requested = process.env["BUILTIN_BROKER"]?.trim().toLowerCase();
  if (requested && requested !== "memory" && requested !== "1" && requested !== "true" && requested !== "on" && requested !== "yes") {
    logger.warn(
      { requested },
      `BUILTIN_BROKER="${requested}" is not an available store yet (only the in-memory store ships today) — ` +
        "falling back to the NON-PERSISTENT memory store. Data will NOT survive a restart until the Postgres store lands.",
    );
  }
  return new BuiltinBroker(new MemoryStore());
}

export { BuiltinBroker } from "./builtin-broker";
export { MemoryStore, type BuiltinStore } from "./store";
