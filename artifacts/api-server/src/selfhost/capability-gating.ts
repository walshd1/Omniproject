/**
 * Self-host capability gating — turns an operator's adoption choices into (a) the set of self-host
 * *domains* that are live for a scope, and (b) the `StoreCapability` the composition tier reads when
 * it plans ownership. It reuses the org → programme → project **feature-resolution** model wholesale:
 * a self-host domain is just a governed catalogue id (`selfhost:<domain>`), so adopting/disabling/
 * mandating one goes through exactly the same monotonic-narrowing + lock semantics as any feature.
 *
 * Nothing here reads settings or Express — it's a pure function of the caller's selections, so the
 * whole gating model is unit-testable and identical wherever it runs (wizard preview, admin screen,
 * gateway enforcement).
 */
import {
  resolveFeatures,
  type FeatureGate,
  type ResolvedFeature,
  type ScopeOverrides,
} from "../lib/feature-resolution";
import type { FieldSupport, StoreCapability, StoreRole } from "../composition/types";
import {
  SELF_HOST_DOMAINS,
  selfHostGovernanceId,
  type SelfHostDomain,
  type SelfHostDomainId,
} from "./domains";

/** How much of a scope's data the self-host DB holds. Off ⇒ it isn't a store at all. */
export type SelfHostMode = "off" | "augmenting" | "system-of-record";

/** The role a self-host store takes in the composition precedence, per mode. */
export function roleForMode(mode: SelfHostMode): StoreRole {
  // system-of-record ⇒ authoritative (owns the field); augmenting ⇒ augmenting (only where no
  // authoritative store can hold it). "off" has no role — callers gate on mode before using this.
  return mode === "system-of-record" ? "authoritative" : "augmenting";
}

/** One scope's adoption selections, mapped onto the feature-resolution vocabulary. */
export interface SelfHostScopeSelection {
  /** Domain ids opted INTO at this scope (the org-level grant; core domains are always allowed). */
  adopted?: readonly SelfHostDomainId[];
  /** Domain ids turned OFF at this scope (soft narrowing — a lower level may narrow further). */
  disabled?: readonly SelfHostDomainId[];
  /** PMO mandate: domains this scope + descendants MUST hold in the self-host DB (locked on). */
  required?: readonly SelfHostDomainId[];
  /** PMO mandate: domains this scope + descendants MUST NOT hold in the self-host DB (locked off). */
  forbidden?: readonly SelfHostDomainId[];
}

/** The full adoption picture for one resolution: the mode + selections at each scope. */
export interface GatingInput {
  mode: SelfHostMode;
  org: SelfHostScopeSelection;
  programme?: SelfHostScopeSelection;
  project?: SelfHostScopeSelection;
}

/** A resolved domain row — the domain metadata plus its resolved on/off + lock detail for a scope. */
export interface DomainRow {
  id: SelfHostDomainId;
  label: string;
  core: boolean;
  gate: SelfHostDomain["gate"];
  unlocks: string;
  fieldCount: number;
  enabled: boolean;
  /** A hard governance mandate locked this state. */
  locked: boolean;
  lockedBy?: "org" | "programme" | "project";
  policy?: "require" | "forbid";
  /** When off, the level that turned it off. */
  blockedAt?: "org" | "programme" | "project";
}

/** The resolved gating: the mode, the per-domain rows, and the flat set of live domain ids. */
export interface SelfHostGating {
  mode: SelfHostMode;
  rows: DomainRow[];
  enabledDomainIds: Set<SelfHostDomainId>;
}

/** The self-host domains as feature-gates: core ⇒ default-on, everything else opt-in with its reason. */
export function selfHostGates(): FeatureGate[] {
  return SELF_HOST_DOMAINS.map((d) => ({
    id: selfHostGovernanceId(d.id),
    ...(d.core ? {} : { defaultOff: true }),
    ...(d.gate ? { reason: d.gate } : {}),
  }));
}

const govId = (ids: readonly SelfHostDomainId[] = []): string[] => ids.map(selfHostGovernanceId);

/** Map the caller's per-scope selections onto the feature-resolution `ScopeOverrides`. */
function overridesFor(input: GatingInput): ScopeOverrides {
  return {
    orgEnabled: govId(input.org.adopted),
    orgDisabled: govId(input.org.disabled),
    orgRequired: govId(input.org.required),
    orgForbidden: govId(input.org.forbidden),
    programmeDisabled: govId(input.programme?.disabled),
    programmeRequired: govId(input.programme?.required),
    programmeForbidden: govId(input.programme?.forbidden),
    projectDisabled: govId(input.project?.disabled),
    projectRequired: govId(input.project?.required),
    projectForbidden: govId(input.project?.forbidden),
  };
}

/**
 * Resolve which self-host domains are live for a scope. When `mode` is `off` the self-host DB is not
 * a store at all, so every domain resolves off regardless of adoption — the mode is the outer switch.
 */
export function resolveGating(input: GatingInput): SelfHostGating {
  const off = input.mode === "off";
  const resolved: ResolvedFeature[] = off ? [] : resolveFeatures(selfHostGates(), overridesFor(input));
  const byId = new Map(resolved.map((r) => [r.id, r]));

  const rows: DomainRow[] = SELF_HOST_DOMAINS.map((d) => {
    const r = byId.get(selfHostGovernanceId(d.id));
    const enabled = off ? false : !!r?.enabled;
    return {
      id: d.id,
      label: d.label,
      core: d.core,
      gate: d.gate,
      unlocks: d.unlocks,
      fieldCount: d.fields.length,
      enabled,
      locked: !!r?.locked,
      ...(r?.lockedBy ? { lockedBy: r.lockedBy } : {}),
      ...(r?.policy ? { policy: r.policy } : {}),
      ...(r && !r.enabled && r.blockedAt ? { blockedAt: r.blockedAt } : {}),
    };
  });

  return {
    mode: input.mode,
    rows,
    enabledDomainIds: new Set(rows.filter((row) => row.enabled).map((row) => row.id)),
  };
}

/**
 * Build the `StoreCapability` the composition tier reads for the self-host store. The store surfaces
 * and stores every field of every ENABLED domain — and nothing else. When the mode is `off` (or no
 * domain is live) the capability is empty: the compositor then plans as if the store isn't there.
 */
export function buildSelfHostCapability(
  gating: SelfHostGating,
  mode: SelfHostMode = gating.mode,
  storeId = "selfhost",
): StoreCapability {
  const fields: Record<string, FieldSupport> = {};
  if (mode !== "off") {
    for (const domain of SELF_HOST_DOMAINS) {
      if (!gating.enabledDomainIds.has(domain.id)) continue;
      for (const f of domain.fields) fields[f.key] = { surface: true, store: true };
    }
  }
  return { storeId, role: roleForMode(mode), fields };
}

/** The per-domain rows for a scope — the admin/wizard read model (a thin re-export of the gating rows). */
export function domainRowsForScope(gating: SelfHostGating): DomainRow[] {
  return gating.rows;
}
