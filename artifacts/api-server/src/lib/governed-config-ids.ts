import { isSecurityConfig } from "./security-config";
import { DEF_SCOPE_POLICY_CONFIG_ID } from "./def-policy";

/**
 * GOVERNED logical config ids — the `config`-def logical ids whose write is reserved to a DEDICATED, governed
 * surface and must NOT be authorable through the generic def importer (`routes/defs`) or a def-store reimport
 * (`lib/def-store-export`).
 *
 * A `config` def resolves by its LOGICAL id via the scope-layered fold (`lib/scoped-config` →
 * `configDefLayers`), so a def carrying one of these ids — smuggled in through the generic authoring path or a
 * crafted backup bundle — would be folded into the resolved value with NONE of the governance its dedicated
 * writer enforces:
 *  - the security-classified configs (`error-telemetry`, `logging-sync`, `history-retention`) REDUCE the
 *    security posture on a relaxing change and are held for a passkey sign-off by `applyConfigCollectionGuarded`;
 *  - `def-scope-policy` sets who may author defs at each scope — lowering that authoring gate is an admin act.
 * Either would let a lower authority (e.g. a `pmo` who clears the org def-write gate) weaken the posture with no
 * proposal and no signature. The importer and reimporter therefore REFUSE these logical ids; the dedicated
 * admin surfaces (settings guard / def-scope-policy route) remain the only writers.
 *
 * This is a small LEAF module on purpose: it composes `isSecurityConfig` (the security-config registry) with the
 * def-scope-policy id, so both write choke points share ONE source of truth and a newly-classified config is
 * covered everywhere at once.
 */
export function isGovernedConfigId(id: string): boolean {
  return isSecurityConfig(id) || id === DEF_SCOPE_POLICY_CONFIG_ID;
}

/** The logical `id` a `config` def carries in its payload (empty string when absent / not a string). */
export function configPayloadId(payload: unknown): string {
  const id = (payload as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" ? id : "";
}
