/**
 * DEF SELECTION BINDINGS (roadmap X.12). The tiered def store (`system` defaults + `org`/`project`/`user`
 * customer defs) is pure CONTENT — it says which defs EXIST, not which one is IN USE. This layer is the
 * missing "which one is selected" concern: for a logical SLOT (e.g. a screen id like `"projects"`, or a
 * methodology slot), which def is chosen at each scope, and whether a higher scope has LOCKED that choice so
 * lower scopes can't override it ("the org mandates this methodology / these screens").
 *
 * The resolution mirrors `feature-resolution.ts`: monotonic narrowing org → project → user, except a LOCKED
 * binding at a higher scope wins and blocks lower overrides. Kept PURE + tested; storage + routes + the
 * render-seam wiring are separate slices. The binding decides the WINNER; the def store still serves content
 * by id.
 */

/** For a slot, the chosen def + whether the choice is locked to lower scopes. */
export interface DefBinding {
  defId: string;
  /** When true, no lower scope may override this slot (an org lock also blocks a project's own binding). */
  locked?: boolean;
}

/** Bindings at each scope. `org` is the ceiling; `project` narrows it; `user` is the individual's own pick
 *  (a user binding never locks anyone else). Mirrors the governance scope maps (org default + per-id maps). */
export interface DefBindingConfig {
  /** slot → binding (org-wide default selection / lock). */
  org?: Record<string, DefBinding>;
  /** projectId → slot → binding. */
  project?: Record<string, Record<string, DefBinding>>;
  /** sub → slot → binding (self-selection). */
  user?: Record<string, Record<string, DefBinding>>;
}

/** The effective selection for a (slot, scope). `defId: null` means no binding — fall back to the system default. */
export interface ResolvedBinding {
  defId: string | null;
  /** A higher scope pinned this slot; lower scopes can't change it. */
  locked: boolean;
  lockedBy?: "org" | "project";
  source: "org" | "project" | "user" | "default";
}

/**
 * Resolve the effective binding for `slot` given the caller's scope. Order:
 *   1. an ORG lock wins absolutely;
 *   2. else a PROJECT lock wins for that project;
 *   3. else most-specific-unlocked wins: user → project → org;
 *   4. else no binding → the system default.
 */
export function resolveDefBinding(config: DefBindingConfig, slot: string, ctx: { projectId?: string; sub?: string }): ResolvedBinding {
  const orgB = config.org?.[slot];
  if (orgB?.locked) return { defId: orgB.defId, locked: true, lockedBy: "org", source: "org" };

  const projB = ctx.projectId ? config.project?.[ctx.projectId]?.[slot] : undefined;
  if (projB?.locked) return { defId: projB.defId, locked: true, lockedBy: "project", source: "project" };

  const userB = ctx.sub ? config.user?.[ctx.sub]?.[slot] : undefined;
  if (userB) return { defId: userB.defId, locked: false, source: "user" };
  if (projB) return { defId: projB.defId, locked: false, source: "project" };
  if (orgB) return { defId: orgB.defId, locked: false, source: "org" };
  return { defId: null, locked: false, source: "default" };
}

/**
 * Whether a principal at `level` may CHANGE the selection for `slot` — i.e. no higher scope has locked it.
 * A `user` is blocked by any lock (org or project); a `project` is blocked only by an ORG lock.
 */
export function canRebind(config: DefBindingConfig, slot: string, level: "project" | "user", ctx: { projectId?: string; sub?: string }): boolean {
  const r = resolveDefBinding(config, slot, ctx);
  if (!r.locked) return true;
  return level === "project" ? r.lockedBy !== "org" : false;
}
