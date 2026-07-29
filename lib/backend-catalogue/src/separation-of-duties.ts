/**
 * SEPARATION-OF-DUTIES (SoD) CONFLICT ENGINE — the "no single person can both create AND approve a payment"
 * control that SOC 2 / ISO 27001 / SOX auditors expect and that the platform did not yet compute (IAM
 * assessment gap S3). Given who holds which grants and a set of toxic-combination policies, it flags every
 * subject that holds BOTH sides of a policy — the classic incompatible-duties conflict — ranks the findings
 * worst-first, rolls them up per subject, and tallies them by severity, so an admin gets "2 critical, 1 high
 * SoD conflict" instead of eyeballing a role matrix.
 *
 * Pure, no I/O, and — like the rest of the catalogue — DETERMINISTIC: no `Date`, no `Math.random`, stable
 * id-tiebroken ordering, so a run (and its test) is reproducible. Validation first and FAIL-CLOSED against
 * malformed input: ids coerced to strings, grant lists coerced to string sets (empty/blank dropped), a policy
 * missing either side (so no toxic combination is even expressible) or a non-object assignment contributes NO
 * finding and NEVER throws. A conflict requires a grant from side `a` AND a grant from side `b` to both be
 * held — both intersections non-empty; empty assignments or empty policies ⇒ empty result.
 *
 * Reuses the canonical RAID/risk severity vocabulary (low → critical) rather than inventing a parallel scale,
 * so a policy's severity sorts and rolls up on the same ordinal the rest of the platform keys off.
 */
import { CanonicalSeverity, SEVERITY_LEVEL } from "./severity-vocabulary";

const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** SoD severity reuses the canonical severity grades (low | medium | high | critical). */
export type SoDSeverity = CanonicalSeverity;

/** The grants (role / permission-set / capability ids or labels) a subject currently holds. */
export interface SoDAssignment {
  subjectId: string;
  grants: string[];
}

/**
 * A toxic-combination policy: holding ANY grant from `a` together with ANY grant from `b` is a conflict
 * (e.g. a = ["create_payment"], b = ["approve_payment"]). Severity grades the finding.
 */
export interface SoDPolicy {
  id: string;
  label: string;
  /** Defaults to "medium" when absent or not a canonical grade. */
  severity?: SoDSeverity;
  a: string[];
  b: string[];
}

/** One detected conflict: a subject holding both sides of a policy, with the offending grants named. */
export interface SoDConflict {
  subjectId: string;
  policyId: string;
  policyLabel: string;
  severity: SoDSeverity;
  /** The grants the subject holds that fall in side `a`, id-sorted. */
  grantsFromA: string[];
  /** The grants the subject holds that fall in side `b`, id-sorted. */
  grantsFromB: string[];
}

/** Per-subject rollup: how many conflicts and the worst severity among them. */
export interface SoDSubjectRollup {
  subjectId: string;
  conflictCount: number;
  /** The highest-severity grade among this subject's conflicts, or null if none. */
  worstSeverity: SoDSeverity | null;
}

export interface SeparationOfDutiesResult {
  /** Every conflict, worst-first: severity (critical → low), then subjectId, then policyId. */
  conflicts: SoDConflict[];
  /** Conflicts rolled up per subject (count + worst severity), subject-id sorted. */
  bySubject: SoDSubjectRollup[];
  /** Conflict tally per severity grade. */
  counts: Record<SoDSeverity, number>;
}

const VALID_SEVERITY = new Set<SoDSeverity>(["low", "medium", "high", "critical"]);
const DEFAULT_SEVERITY: SoDSeverity = "medium";

/** Coerce an unknown value into a set of non-blank strings; anything that isn't an array ⇒ empty set. */
function toStringSet(value: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(value)) return out;
  for (const v of value) {
    if (v === undefined || v === null) continue;
    const s = String(v);
    if (s !== "") out.add(s);
  }
  return out;
}

interface NormPolicy {
  id: string;
  label: string;
  severity: SoDSeverity;
  a: Set<string>;
  b: Set<string>;
}

/**
 * Detect separation-of-duties conflicts: subjects holding both sides of a toxic-combination policy. Empty
 * assignments or policies ⇒ empty result. Malformed entries are dropped, never thrown on (fail-closed).
 */
export function findSeparationOfDutiesConflicts(
  assignments: readonly SoDAssignment[],
  policies: readonly SoDPolicy[],
): SeparationOfDutiesResult {
  const safeAssignments = Array.isArray(assignments) ? assignments : [];
  const safePolicies = Array.isArray(policies) ? policies : [];

  // Normalize policies once; a policy missing either side can express no toxic combination ⇒ dropped.
  const normPolicies: NormPolicy[] = [];
  for (const p of safePolicies) {
    if (p === null || typeof p !== "object") continue;
    const a = toStringSet((p as SoDPolicy).a);
    const b = toStringSet((p as SoDPolicy).b);
    if (a.size === 0 || b.size === 0) continue;
    const rawSeverity = (p as SoDPolicy).severity as SoDSeverity | undefined;
    const severity = rawSeverity !== undefined && VALID_SEVERITY.has(rawSeverity) ? rawSeverity : DEFAULT_SEVERITY;
    normPolicies.push({ id: String((p as SoDPolicy).id), label: String((p as SoDPolicy).label ?? ""), severity, a, b });
  }

  const conflicts: SoDConflict[] = [];
  for (const asgn of safeAssignments) {
    if (asgn === null || typeof asgn !== "object") continue;
    const held = toStringSet((asgn as SoDAssignment).grants);
    if (held.size === 0) continue;
    const subjectId = String((asgn as SoDAssignment).subjectId);
    const heldList = [...held].sort(byStr);
    for (const p of normPolicies) {
      const grantsFromA = heldList.filter((g) => p.a.has(g));
      if (grantsFromA.length === 0) continue;
      const grantsFromB = heldList.filter((g) => p.b.has(g));
      if (grantsFromB.length === 0) continue;
      conflicts.push({ subjectId, policyId: p.id, policyLabel: p.label, severity: p.severity, grantsFromA, grantsFromB });
    }
  }

  // Worst-first: severity descending (critical → low), then subjectId, then policyId.
  conflicts.sort((x, y) => {
    const lvl = SEVERITY_LEVEL[y.severity] - SEVERITY_LEVEL[x.severity];
    if (lvl !== 0) return lvl;
    if (x.subjectId !== y.subjectId) return byStr(x.subjectId, y.subjectId);
    return byStr(x.policyId, y.policyId);
  });

  // Per-subject rollup: conflict count + worst (highest-level) severity.
  const rollup = new Map<string, { count: number; worstLevel: number; worstSeverity: SoDSeverity }>();
  for (const c of conflicts) {
    const level = SEVERITY_LEVEL[c.severity];
    const cur = rollup.get(c.subjectId);
    if (cur === undefined) {
      rollup.set(c.subjectId, { count: 1, worstLevel: level, worstSeverity: c.severity });
    } else {
      cur.count += 1;
      if (level > cur.worstLevel) {
        cur.worstLevel = level;
        cur.worstSeverity = c.severity;
      }
    }
  }
  const bySubject: SoDSubjectRollup[] = [...rollup.entries()]
    .map(([subjectId, r]) => ({ subjectId, conflictCount: r.count, worstSeverity: r.worstSeverity }))
    .sort((a, b) => byStr(a.subjectId, b.subjectId));

  const counts: Record<SoDSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const c of conflicts) counts[c.severity] += 1;

  return { conflicts, bySubject, counts };
}
