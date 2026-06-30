/**
 * Hierarchical feature resolution — the pure core of the org → programme → project gating model.
 *
 * The rule is **monotonic narrowing**: each level can only ever *remove* features, never add. So a
 * feature is enabled for a project iff it survives every level above it:
 *
 *   core (always on)  ⊇  org-approved superset  ⊇  programme subset  ⊇  project subset
 *
 *   - **Org (admin)** sets the approved superset: everything is ON by default *except* features marked
 *     `defaultOff` for a safety / cost / storage reason, which need an explicit org opt-in.
 *   - **Programme (pmo)** disables features for a programme — inherited by all its projects. It has only
 *     a "disabled" list, so it can never grant something the org didn't allow.
 *   - **Project (manager)** disables features for one project, within whatever the programme (or org, for
 *     a standalone project) already allows. Again disable-only, so it can't exceed its parent.
 *
 * This module is pure (no settings/express) so the whole model is unit-testable; the gateway maps the
 * feature registry + settings overrides into these inputs.
 */

export type GateReason = "safety" | "cost" | "storage";

/** A gateable feature plus its default posture. (Core, always-on routes are not gates and aren't listed.) */
export interface FeatureGate {
  id: string;
  /** When true the feature is OFF for everyone until the org explicitly opts in (a safety/cost/storage call). */
  defaultOff?: boolean;
  /** Why it's default-off — shown to the admin so the choice is informed. */
  reason?: GateReason;
}

/** The disable/enable lists captured at each scope. Programme/project are disable-only by design. */
export interface ScopeOverrides {
  /** Org admin: features turned OFF org-wide. */
  orgDisabled?: Iterable<string>;
  /** Org admin: `defaultOff` features the org has opted INTO. */
  orgEnabled?: Iterable<string>;
  /** Programme (pmo): features turned off for a programme (⊆ the org-approved set). */
  programmeDisabled?: Iterable<string>;
  /** Project (manager): features turned off for a project (⊆ the programme/org set). */
  projectDisabled?: Iterable<string>;
}

export type BlockLevel = "org" | "programme" | "project";

export interface ResolvedFeature {
  id: string;
  enabled: boolean;
  /** The highest level that turned it off (null when enabled) — so the UI can say "off at programme level". */
  blockedAt: BlockLevel | null;
  defaultOff: boolean;
  reason?: GateReason;
}

/**
 * Does the org permit this feature at all? This is the superset the lower levels narrow within.
 * A `defaultOff` feature is permitted only when explicitly opted in; an explicit org disable always wins.
 */
export function orgAllows(gate: FeatureGate, orgDisabled: ReadonlySet<string>, orgEnabled: ReadonlySet<string>): boolean {
  if (orgDisabled.has(gate.id)) return false;
  if (gate.defaultOff) return orgEnabled.has(gate.id);
  return true;
}

/** Resolve every gate against the scope overrides, reporting where each was blocked. */
export function resolveFeatures(gates: readonly FeatureGate[], overrides: ScopeOverrides = {}): ResolvedFeature[] {
  const orgDisabled = new Set(overrides.orgDisabled ?? []);
  const orgEnabled = new Set(overrides.orgEnabled ?? []);
  const programmeDisabled = new Set(overrides.programmeDisabled ?? []);
  const projectDisabled = new Set(overrides.projectDisabled ?? []);

  return gates.map((g) => {
    let blockedAt: BlockLevel | null = null;
    if (!orgAllows(g, orgDisabled, orgEnabled)) blockedAt = "org";
    else if (programmeDisabled.has(g.id)) blockedAt = "programme";
    else if (projectDisabled.has(g.id)) blockedAt = "project";
    return { id: g.id, enabled: blockedAt === null, blockedAt, defaultOff: !!g.defaultOff, ...(g.reason ? { reason: g.reason } : {}) };
  });
}

/** The set of enabled feature ids for a scope — the convenience accessor the gateway/SPA gate on. */
export function effectiveEnabledIds(gates: readonly FeatureGate[], overrides: ScopeOverrides = {}): Set<string> {
  return new Set(resolveFeatures(gates, overrides).filter((r) => r.enabled).map((r) => r.id));
}

/**
 * The features a given level is *allowed to manage* — i.e. the set its parent already permits, so a UI
 * can show a programme manager only what the org allows (and a PM only what the programme allows). This
 * is what enforces "cannot add beyond the parent grant": the parent set is the ceiling.
 */
export function manageableAtProgramme(gates: readonly FeatureGate[], overrides: ScopeOverrides): Set<string> {
  const orgDisabled = new Set(overrides.orgDisabled ?? []);
  const orgEnabled = new Set(overrides.orgEnabled ?? []);
  return new Set(gates.filter((g) => orgAllows(g, orgDisabled, orgEnabled)).map((g) => g.id));
}

/** The features a PM may manage for a project: the org-approved set minus whatever the programme removed. */
export function manageableAtProject(gates: readonly FeatureGate[], overrides: ScopeOverrides): Set<string> {
  // The project ceiling is the org-approved set minus whatever the programme already removed.
  const programmeDisabled = new Set(overrides.programmeDisabled ?? []);
  return new Set([...manageableAtProgramme(gates, overrides)].filter((id) => !programmeDisabled.has(id)));
}
