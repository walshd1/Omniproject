import { BUILTIN_BROKER, type BrokerBackend } from "./field-target";
import type { CapabilityFlags } from "../broker/types";

/**
 * OMNISTORE HOMING — OmniStore as the System-of-Record OF LAST RESORT. ("OmniStore should, if enabled,
 * be the home for any orphaned data which has no other SoR — so when it is the only backend, by
 * definition that's 100% of the data.")
 *
 * Two honest invariants follow. They are PURE here; the single env read (`omnistoreEnabled`) is the one
 * thin impure boundary, so the resolvers stay testable:
 *
 *  1. HOMING. When OmniStore is enabled, a field that would otherwise be HOMELESS — no external backend
 *     and no declared home — resolves to the OmniStore home instead of null. This is NOT the silent
 *     builtin/sidecar fallback we deliberately removed (field-target, "homeless is a decision"): it is a
 *     home the operator DECLARED by turning OmniStore on, applied ONLY to orphans. A field that names its
 *     own external backend (Jira, Todoist, …) is never redirected — its explicit home always wins.
 *
 *  2. SUPERSET WHEN SOLE. OmniStore persists the WHOLE row for any vendor shape (see the omnistore
 *     superset test), so a domain whose data it homes is a domain it can honestly serve. When OmniStore
 *     is the ONLY backend it homes 100% of the data, so it offers the full capability superset — every
 *     domain on. (Read-model roll-ups a Phase-1 store doesn't compute still return honest empties; the
 *     raw fields round-trip, which is what the domain flag gates.)
 */

/** The backend id of the OmniStore SoR-of-last-resort, fronted by the built-in broker. */
export const OMNISTORE_BACKEND = "omnistore";

/** The declared last-resort home: the built-in broker over the OmniStore backend. */
export const OMNISTORE_HOME: BrokerBackend = { broker: BUILTIN_BROKER, backend: OMNISTORE_BACKEND };

/** True when the built-in broker is running the OmniStore store — the enablement signal, the same env the
 *  built-in factory switches on (`BUILTIN_BROKER=omnistore`). The one impure read; keep the resolvers pure. */
export function omnistoreEnabled(): boolean {
  return process.env["BUILTIN_BROKER"]?.trim().toLowerCase() === OMNISTORE_BACKEND;
}

/** The last-resort home to fold into routing: the OmniStore home when enabled, else null — with null the
 *  orphans stay HOMELESS (a decision surfaced to the admin), exactly as before OmniStore was turned on. */
export function omnistoreLastResort(enabled: boolean = omnistoreEnabled()): BrokerBackend | null {
  return enabled ? OMNISTORE_HOME : null;
}

/**
 * The capability superset OmniStore offers as SoR-of-last-resort — every gateway capability domain ON,
 * because it homes any orphaned data (100% of it when it is the only backend). Kept as an EXPLICIT set
 * below the broker seam (the broker plane can't import the gateway's `CAPABILITY_DOMAINS` without a load
 * cycle); a drift test asserts it stays EXACTLY that domain list, so it can never silently fall behind.
 */
export const OMNISTORE_SUPERSET_DOMAINS: readonly string[] = [
  "issues", "scheduling", "resources", "financials", "portfolio", "baseline", "blockers", "history",
  "raid", "quality", "crm", "service", "benefits", "stakeholders", "raci",
];

/** The full {@link CapabilityFlags} OmniStore declares when it homes the data — every superset domain true. */
export function omnistoreSupersetCapabilities(): CapabilityFlags {
  return Object.fromEntries(OMNISTORE_SUPERSET_DOMAINS.map((d) => [d, true]));
}
