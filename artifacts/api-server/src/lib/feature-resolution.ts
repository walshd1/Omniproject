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

/**
 * The policy captured at each scope. Two strengths:
 *   - **soft** `disabled`/`enabled` lists — the everyday narrowing (a lower level may further disable).
 *   - **hard** `required`/`forbidden` lists — governance mandates ("must use" / "must not use") authored
 *     through the business-ruleset engine. A hard rule from an ancestor **locks** the item so descendants
 *     can't override it. Higher scope wins; a lower level can never mandate something its parent forbade
 *     or never allowed (monotonicity holds).
 */
export interface ScopeOverrides {
  /** Org admin: features turned OFF org-wide (soft). */
  orgDisabled?: Iterable<string>;
  /** Org admin: `defaultOff` features the org has opted INTO. */
  orgEnabled?: Iterable<string>;
  /** Org (PMO mandate): items every programme/project MUST use — forced on, locked. */
  orgRequired?: Iterable<string>;
  /** Org (PMO mandate): items that MUST NOT be used anywhere — forced off, locked. */
  orgForbidden?: Iterable<string>;
  /** Programme (pmo): features turned off for a programme (soft, ⊆ org-approved). */
  programmeDisabled?: Iterable<string>;
  /** Programme (pmo mandate): forced on for the programme + its projects (within org-approved). */
  programmeRequired?: Iterable<string>;
  /** Programme (pmo mandate): forced off for the programme + its projects. */
  programmeForbidden?: Iterable<string>;
  /** Project (manager): features turned off for a project (soft). */
  projectDisabled?: Iterable<string>;
  /** Project (manager mandate): forced on for this project (within the programme/org grant). */
  projectRequired?: Iterable<string>;
  /** Project (manager mandate): forced off for this project. */
  projectForbidden?: Iterable<string>;
}

export type BlockLevel = "org" | "programme" | "project";

export interface ResolvedFeature {
  id: string;
  enabled: boolean;
  /** The highest level that turned it off (null when enabled) — so the UI can say "off at programme level". */
  blockedAt: BlockLevel | null;
  /** A hard governance mandate locked this state — descendants can't change it. */
  locked: boolean;
  /** The scope + verb of the lock, when locked. */
  lockedBy?: BlockLevel;
  policy?: "require" | "forbid";
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

/**
 * Resolve every gate against the scope overrides.
 *
 * Order (org is the ceiling, then each level narrows within its parent's grant):
 *   1. org `forbid`  → off, locked@org.
 *   2. org not-allowed (default-off & not opted in, or org-disabled, and not org-required) → off@org.
 *   3. org `require` → on, locked@org (a mandate; overrides default-off).
 *   4. programme `forbid` → off locked@programme · `require` → on locked@programme · `disabled` → off@programme.
 *   5. project `forbid` → off locked@project · `require` → on locked@project · `disabled` → off@project.
 *   6. otherwise on.
 * Because each step is bounded by the previous, a lower level can never mandate something its parent
 * forbade or never allowed.
 */
export function resolveFeatures(gates: readonly FeatureGate[], overrides: ScopeOverrides = {}): ResolvedFeature[] {
  const orgDisabled = new Set(overrides.orgDisabled ?? []);
  const orgEnabled = new Set(overrides.orgEnabled ?? []);
  const orgRequired = new Set(overrides.orgRequired ?? []);
  const orgForbidden = new Set(overrides.orgForbidden ?? []);
  const programmeDisabled = new Set(overrides.programmeDisabled ?? []);
  const programmeRequired = new Set(overrides.programmeRequired ?? []);
  const programmeForbidden = new Set(overrides.programmeForbidden ?? []);
  const projectDisabled = new Set(overrides.projectDisabled ?? []);
  const projectRequired = new Set(overrides.projectRequired ?? []);
  const projectForbidden = new Set(overrides.projectForbidden ?? []);

  return gates.map((g) => {
    const base = { id: g.id, defaultOff: !!g.defaultOff, ...(g.reason ? { reason: g.reason } : {}) };
    const off = (blockedAt: BlockLevel, lock?: BlockLevel): ResolvedFeature =>
      ({ ...base, enabled: false, blockedAt, locked: !!lock, ...(lock ? { lockedBy: lock, policy: "forbid" as const } : {}) });
    const on = (lock?: BlockLevel): ResolvedFeature =>
      ({ ...base, enabled: true, blockedAt: null, locked: !!lock, ...(lock ? { lockedBy: lock, policy: "require" as const } : {}) });

    // 1-3: org is the ceiling.
    if (orgForbidden.has(g.id)) return off("org", "org");
    if (!orgRequired.has(g.id) && !orgAllows(g, orgDisabled, orgEnabled)) return off("org");
    if (orgRequired.has(g.id)) return on("org");
    // 4: programme, within the org grant.
    if (programmeForbidden.has(g.id)) return off("programme", "programme");
    if (programmeRequired.has(g.id)) return on("programme");
    if (programmeDisabled.has(g.id)) return off("programme");
    // 5: project, within the programme grant.
    if (projectForbidden.has(g.id)) return off("project", "project");
    if (projectRequired.has(g.id)) return on("project");
    if (projectDisabled.has(g.id)) return off("project");
    // 6.
    return on();
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
  // An org `forbid` is a hard lock: it's never manageable below the org, so a programme can't
  // re-`require` it (the resolver would block it anyway, but the ceiling must not claim otherwise).
  const orgForbidden = new Set(overrides.orgForbidden ?? []);
  return new Set(
    gates.filter((g) => !orgForbidden.has(g.id) && orgAllows(g, orgDisabled, orgEnabled)).map((g) => g.id),
  );
}

/** The features a PM may manage for a project: the org-approved set minus whatever the programme removed. */
export function manageableAtProject(gates: readonly FeatureGate[], overrides: ScopeOverrides): Set<string> {
  // The project ceiling is the org-approved set minus whatever the programme already removed —
  // both its soft `disabled` narrowing and its hard `forbid` locks.
  const programmeDisabled = new Set(overrides.programmeDisabled ?? []);
  const programmeForbidden = new Set(overrides.programmeForbidden ?? []);
  return new Set(
    [...manageableAtProgramme(gates, overrides)].filter(
      (id) => !programmeDisabled.has(id) && !programmeForbidden.has(id),
    ),
  );
}
