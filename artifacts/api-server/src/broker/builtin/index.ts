import { logger } from "../../lib/logger";
import { BuiltinBroker } from "./builtin-broker";
import { MemoryStore, type BuiltinStore } from "./store";
import { SidecarStore } from "./sidecar-store";

/**
 * The built-in broker — selection + store wiring. Opt-in via `BUILTIN_BROKER`; off by default so the
 * stateless overlay / demo stays the default. The value chooses the backing store:
 *   - `memory` (or any bare-truthy value): in-process, non-persistent — tests / ephemeral use.
 *   - `sidecar` (aliases `sql`, `postgres`, `mysql`, `mssql`): a durable, customer-owned store via
 *     the existing DB **sidecar** vendor over HTTP — the gateway stays STATELESS (the sidecar holds
 *     the DB credentials) and needs no n8n. Requires `SQL_SIDECAR_URL` (+ optional `SQL_SIDECAR_TOKEN`);
 *     if the URL is missing it falls back to the non-persistent memory store with a loud warning, so
 *     a mis-set value can never silently pretend to persist.
 */
export function builtinBrokerEnabled(): boolean {
  const raw = process.env["BUILTIN_BROKER"]?.trim().toLowerCase();
  return !!raw && raw !== "0" && raw !== "false" && raw !== "off";
}

const SIDECAR_ALIASES = new Set(["sidecar", "sql", "postgres", "postgresql", "mysql", "mssql", "database", "db"]);

/** Build the built-in broker for the configured store. `sidecar`/`sql`/`postgres` → the DB sidecar
 *  (stateless gateway); anything else → the in-memory store. Falls back to memory (with a warning)
 *  if a sidecar was asked for but `SQL_SIDECAR_URL` isn't set — never silently pretend to persist. */
export function makeBuiltinBroker(): BuiltinBroker {
  return new BuiltinBroker(selectStore());
}

function selectStore(): BuiltinStore {
  const requested = process.env["BUILTIN_BROKER"]?.trim().toLowerCase() ?? "";
  if (SIDECAR_ALIASES.has(requested)) {
    const url = process.env["SQL_SIDECAR_URL"]?.trim();
    if (url) return new SidecarStore(url, process.env["SQL_SIDECAR_TOKEN"]?.trim() || undefined);
    logger.warn(
      { requested },
      `BUILTIN_BROKER="${requested}" needs SQL_SIDECAR_URL (the DB sidecar that holds the connection) — ` +
        "it is unset, so falling back to the NON-PERSISTENT memory store. Data will NOT survive a restart.",
    );
  }
  return new MemoryStore();
}

export { BuiltinBroker } from "./builtin-broker";
export { MemoryStore, type BuiltinStore } from "./store";
export { SidecarStore } from "./sidecar-store";
