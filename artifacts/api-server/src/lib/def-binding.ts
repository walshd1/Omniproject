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

import { getArtifact, putArtifact, type ArtifactScope } from "./artifact-store";

/** For a slot, the chosen def + whether the choice is locked to lower scopes. */
export interface DefBinding {
  defId: string;
  /** When true, no lower scope may override this slot (an org lock also blocks a project's own binding). */
  locked?: boolean;
}

// ── Slot vocabulary ──────────────────────────────────────────────────────────────────────────────────────
// A slot is an opaque string; the resolver never inspects it. But a slot must be UNAMBIGUOUS across the def
// kinds that share this layer, so each kind namespaces its slots. Screens/reports/methodologies use their bare
// logical id (`"projects"`, `"burn-rate"`); PRIMITIVES use `primitive:<id>` so an org can pin WHICH activated
// primitive is in use for a family and LOCK it, without colliding with a same-named screen/report slot. Locking
// a primitive slot is the mechanism behind "the org mandates this primitive down the subtree — a project can't
// re-fork or re-select it": a project's own activated primitive (roadmap X — per-scope activation) is shadowed
// by the org's locked selection exactly like any other slot.
const PRIMITIVE_SLOT_PREFIX = "primitive:";

/** The binding slot key for a primitive family (namespaced, so it never collides with a screen/report slot). */
export function primitiveSlot(primitiveId: string): string {
  return `${PRIMITIVE_SLOT_PREFIX}${primitiveId}`;
}

/** Whether a slot addresses a primitive selection (vs a screen/report/methodology slot). */
export function isPrimitiveSlot(slot: string): boolean {
  return slot.startsWith(PRIMITIVE_SLOT_PREFIX);
}

/** Bindings at each scope. `org` is the ceiling; `project` narrows it; `user` is the individual's own pick
 *  (a user binding never locks anyone else). Mirrors the governance scope maps (org default + per-id maps). */
export interface DefBindingConfig {
  /** slot → binding (org-wide default selection / lock). */
  org?: Record<string, DefBinding>;
  /** programmeId → slot → binding (sits between org and project). */
  programme?: Record<string, Record<string, DefBinding>>;
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
  lockedBy?: "org" | "programme" | "project";
  source: "org" | "programme" | "project" | "user" | "default";
}

/**
 * Resolve the effective binding for `slot` given the caller's scope. The chain is
 * user → project → programme → org → system-default. Locks narrow from the top:
 *   1. an ORG lock wins absolutely;
 *   2. else a PROGRAMME lock wins for that programme's projects;
 *   3. else a PROJECT lock wins for that project's users;
 *   4. else most-specific-unlocked wins: user → project → programme → org;
 *   5. else no binding → the system default (`defId: null`).
 */
export function resolveDefBinding(config: DefBindingConfig, slot: string, ctx: { projectId?: string; programmeId?: string; sub?: string }): ResolvedBinding {
  const orgB = config.org?.[slot];
  if (orgB?.locked) return { defId: orgB.defId, locked: true, lockedBy: "org", source: "org" };

  const progB = ctx.programmeId ? config.programme?.[ctx.programmeId]?.[slot] : undefined;
  if (progB?.locked) return { defId: progB.defId, locked: true, lockedBy: "programme", source: "programme" };

  const projB = ctx.projectId ? config.project?.[ctx.projectId]?.[slot] : undefined;
  if (projB?.locked) return { defId: projB.defId, locked: true, lockedBy: "project", source: "project" };

  const userB = ctx.sub ? config.user?.[ctx.sub]?.[slot] : undefined;
  if (userB) return { defId: userB.defId, locked: false, source: "user" };
  if (projB) return { defId: projB.defId, locked: false, source: "project" };
  if (progB) return { defId: progB.defId, locked: false, source: "programme" };
  if (orgB) return { defId: orgB.defId, locked: false, source: "org" };
  return { defId: null, locked: false, source: "default" };
}

/**
 * Whether a principal at `level` may CHANGE the selection for `slot` — i.e. no higher scope has locked it.
 * A `user` is blocked by ANY lock; a `project` is blocked by an org or programme lock; a `programme` is
 * blocked only by an ORG lock.
 */
export function canRebind(config: DefBindingConfig, slot: string, level: "programme" | "project" | "user", ctx: { projectId?: string; programmeId?: string; sub?: string }): boolean {
  const r = resolveDefBinding(config, slot, ctx);
  if (!r.locked) return true;
  if (level === "user") return false;
  if (level === "programme") return r.lockedBy !== "org";
  // project: an org OR a programme lock blocks it.
  return r.lockedBy !== "org" && r.lockedBy !== "programme";
}

// ── Storage ──────────────────────────────────────────────────────────────────────────────────────────────
// Bindings are stored PER SCOPE in the sealed artifact store (like def-policy / custom-roles): one map per
// scope file. A `project` binding physically lives in THAT project's scope, so a PM's change is confined to
// their project by construction — it can't leak org-wide or to another project.
export const BINDING_ARTIFACT = "def-binding";
const BINDINGS_ID = "bindings";
interface StoredBindings { id: string; bindings: Record<string, DefBinding> }

/** The slot→binding map stored at one scope (empty when unset / store off). */
export function getScopeBindings(scope: ArtifactScope): Record<string, DefBinding> {
  return getArtifact<StoredBindings>(BINDING_ARTIFACT, scope, BINDINGS_ID)?.bindings ?? {};
}

/** Set (or clear, with `binding: null`) one slot's binding at a scope; returns the new map. */
export function setScopeBinding(scope: ArtifactScope, slot: string, binding: DefBinding | null): Record<string, DefBinding> {
  const next = { ...getScopeBindings(scope) };
  if (binding === null) delete next[slot];
  else next[slot] = binding;
  putArtifact<StoredBindings>(BINDING_ARTIFACT, scope, { id: BINDINGS_ID, bindings: next });
  return next;
}

/** Assemble the resolution config for a caller — org + ONLY their programme + ONLY their project + ONLY their
 *  user layers. `programmeId` is the caller's project's programme, when it belongs to one. */
export function loadBindingConfig(ctx: { projectId?: string; programmeId?: string; sub?: string }): DefBindingConfig {
  const config: DefBindingConfig = { org: getScopeBindings({ kind: "org" }) };
  if (ctx.programmeId) config.programme = { [ctx.programmeId]: getScopeBindings({ kind: "programme", programmeId: ctx.programmeId }) };
  if (ctx.projectId) config.project = { [ctx.projectId]: getScopeBindings({ kind: "project", projectId: ctx.projectId }) };
  if (ctx.sub) config.user = { [ctx.sub]: getScopeBindings({ kind: "user", sub: ctx.sub }) };
  return config;
}
