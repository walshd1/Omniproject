/**
 * SEPARATION-OF-DUTIES (SoD) POLICY SEAM — the runtime glue that makes the pure `separation-of-duties`
 * catalogue engine actually enforce something (IAM assessment gap S3). It does two jobs:
 *
 *  1. `sodPolicyState()` — load the toxic-combination policies from the `SOD_POLICIES` env (a JSON array
 *     of `{ id, label, severity?, a[], b[] }`). Mirrors the `DATA_RESIDENCY_POLICY` idiom exactly: a
 *     JSON-string env, memoised by raw text, **INERT when unset** (no policy ⇒ nothing flagged ⇒ the
 *     control is off and every existing deployment is unaffected), and **FAIL-CLOSED on malformed JSON**
 *     (a policy set that can't be parsed can't prove an authority grant is SoD-clean, so the caller
 *     refuses the change rather than silently skipping the control).
 *  2. `prospectiveRoleMap` / `roleMapToSoDAssignments` — pure helpers that turn a role→IdP-group map into
 *     the "which subject holds which authorities" view the engine consumes. The subject is an IdP GROUP;
 *     its grants are the ROLES that group is mapped into. So a policy like `{ a:["admin"], b:["pmo"] }`
 *     flags any single group granted both the technical-admin and the business-governance authority — the
 *     exact orthogonal-authority combination `lib/rbac` documents as separable and SoD is meant to catch.
 *
 * No engine change: `findSeparationOfDutiesConflicts` is consumed as-is, and its `policies:[]` fast-path
 * is what guarantees the whole thing is a no-op until an operator sets `SOD_POLICIES`.
 */
import type { SoDAssignment, SoDPolicy } from "@workspace/backend-catalogue";

/** One IdP group + the roles it is mapped into — the shape both `getRoleMap()` rows and our helpers use. */
type RoleClaims = { role: string; claims: string[] };

export interface SodPolicyState {
  policies: SoDPolicy[];
  /** Set when `SOD_POLICIES` is present but not a parseable JSON array — the caller fails closed on it. */
  error: string | null;
}

let cache: { raw: string; state: SodPolicyState } | null = null;

/**
 * Load + validate the SoD policies from `SOD_POLICIES` (a JSON array), memoised by raw text. Unset/blank
 * ⇒ inert (`{ policies: [], error: null }`). Present-but-unparseable (bad JSON, or JSON that isn't an
 * array) ⇒ `error` set so the caller can FAIL CLOSED. Individual malformed policies inside a valid array
 * are left to the engine, which drops them fail-closed (a policy missing either side expresses no
 * toxic combination) — so the loader only guards the outer shape.
 */
export function sodPolicyState(env: NodeJS.ProcessEnv = process.env): SodPolicyState {
  const raw = env["SOD_POLICIES"]?.trim() ?? "";
  if (!raw) return { policies: [], error: null };
  if (cache && cache.raw === raw) return cache.state;
  let state: SodPolicyState;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("SOD_POLICIES must be a JSON array of policies");
    state = { policies: parsed as SoDPolicy[], error: null };
  } catch (e) {
    state = { policies: [], error: e instanceof Error ? e.message : "unparseable JSON" };
  }
  cache = { raw, state };
  return state;
}

const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Fold a proposed role-map edit (`body`, `{ role: string[] }`) onto the current effective map WITHOUT
 * mutating any global state, so SoD can be evaluated against the map the edit WOULD produce. Body groups
 * are normalised the same way `setRoleMap` normalises them (trim + lower-case, blanks dropped) so the
 * prospective map matches exactly what would be stored. Roles absent from the body keep their current claims.
 */
export function prospectiveRoleMap(current: readonly RoleClaims[], body: unknown): RoleClaims[] {
  const overrides = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  return current.map(({ role, claims }) => {
    const v = overrides[role];
    if (Array.isArray(v)) {
      const groups = v
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      return { role, claims: groups };
    }
    return { role, claims: [...claims] };
  });
}

/**
 * Invert a role→group map into SoD assignments: one subject per IdP group, its grants = the roles that
 * group is mapped into. Deterministic (subject-id and grant sorted) so a run and its test are reproducible.
 */
export function roleMapToSoDAssignments(map: readonly RoleClaims[]): SoDAssignment[] {
  const byGroup = new Map<string, Set<string>>();
  for (const { role, claims } of map) {
    for (const group of claims) {
      let grants = byGroup.get(group);
      if (!grants) {
        grants = new Set<string>();
        byGroup.set(group, grants);
      }
      grants.add(role);
    }
  }
  return [...byGroup.entries()]
    .map(([subjectId, grants]) => ({ subjectId, grants: [...grants].sort(byStr) }))
    .sort((a, b) => byStr(a.subjectId, b.subjectId));
}
