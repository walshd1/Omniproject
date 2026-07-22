/**
 * DELEGATION POLICY — the admin-set governance dial for how far DOWN the scope hierarchy local variation is
 * allowed for each governed area (rulesets, settings, methodology). The org admin picks, per area, the deepest
 * scope that may override the org baseline; a write at a deeper scope is rejected. This is the "set the level
 * of local variation you'll allow, and no further" model — pure logic here, enforced at the write seam.
 *
 * Levels are ORDERED by depth: org (0, no local variation — everyone inherits the org) < programme (1) <
 * project (2) < user (3). A policy of `org` locks the area to the org; `programme` lets a programme differ but
 * not its projects; `project` lets a project differ too; `user` (rare, but possible) lets an individual differ
 * from their project. The DEFAULT is `org` for every area, so nothing is delegated until an admin opens it up
 * (a safe, no-behaviour-change default).
 */

/** The governed areas a delegation depth applies to. */
export const DELEGATION_AREAS = ["ruleset", "settings", "methodologyComposition"] as const;
export type DelegationArea = (typeof DELEGATION_AREAS)[number];

/** The scope levels a variation can be allowed down to, shallowest → deepest. `user` is rare but supported. */
export const DELEGATION_LEVELS = ["org", "programme", "project", "user"] as const;
export type DelegationLevel = (typeof DELEGATION_LEVELS)[number];

/** The full policy: the max override level for each area. */
export type DelegationPolicy = Record<DelegationArea, DelegationLevel>;

/** Centralized default — no area is delegated below the org. Applying it changes nothing. */
export const DEFAULT_DELEGATION_POLICY: DelegationPolicy = {
  ruleset: "org",
  settings: "org",
  methodologyComposition: "org",
};

/** A level's depth (org=0 … user=3); unknown → 0 (org, the safe/tightest). */
export function levelDepth(level: string): number {
  const i = (DELEGATION_LEVELS as readonly string[]).indexOf(level);
  return i < 0 ? 0 : i;
}

/**
 * May a write at `target` scope proceed under a policy that allows variation down to `allowed`? True when the
 * target is no deeper than the allowed level. An `org` target is ALWAYS allowed (the org baseline is never a
 * "local variation"); a `programme`/`project` target needs the policy to reach that depth.
 */
export function isDelegationAllowed(allowed: string, target: string): boolean {
  if (target === "org") return true;
  return levelDepth(target) <= levelDepth(allowed);
}

/** Coerce untrusted input (imported/stored) into a valid policy, filling unknowns from the default. */
export function cleanDelegationPolicy(input: unknown): DelegationPolicy {
  const src = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_DELEGATION_POLICY };
  for (const area of DELEGATION_AREAS) {
    const v = src[area];
    if (typeof v === "string" && (DELEGATION_LEVELS as readonly string[]).includes(v)) {
      out[area] = v as DelegationLevel;
    }
  }
  return out;
}
