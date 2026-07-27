/**
 * SKILLS GAP-ANALYSIS ENGINE — a pure, STATELESS competency-coverage analyser over the resource-skill
 * holdings a portfolio already records (roadmap §4.2, "Skills/competency matrix + gap analysis — records ✅,
 * the gap-analysis roll-up remains"). The `skill` + `resource_skill` records store WHO holds WHICH skill at
 * WHAT proficiency (novice → expert); nothing crossed that against DEMAND to say "we need 3 people at
 * advanced+ in Kubernetes and have 1 — gap 2". This does: per required skill it counts the qualifying supply
 * (distinct resources at or above the required proficiency), the shortfall, a guarded coverage ratio and the
 * mean proficiency, ranks the register worst-gap first, and surfaces the bench (skills held but not demanded).
 *
 * Proficiency is an ordinal ladder (novice=1 … expert=4, the shipped `resource_skill.rsProficiency` set),
 * caller-overridable. Mirrors `capacity` (supply-vs-demand, but over competencies not periods) and
 * `task-workload` (validation-first roll-up); REUSES the `num` guarded helpers rather than re-deriving
 * coercion. Pure, no I/O, DETERMINISTIC (no `Date`, no `Math.random`; every ranking id-tiebroken).
 * Validation-first and fail-closed: ids coerced, non-object rows dropped, an unknown/absent proficiency ranks
 * 0 (so it never satisfies a real requirement — fail-closed), a resource listed twice for a skill keeps its
 * highest level, every divide guarded (coverage is null when the required count is 0) — it never throws.
 * Empty ⇒ empty.
 */
import { numLoose, optNum, round2 } from "./num";

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The shipped proficiency ladder (mirrors the `resource_skill.rsProficiency` enum). Higher = more skilled. */
export const PROFICIENCY_RANK: Readonly<Record<string, number>> = { novice: 1, intermediate: 2, advanced: 3, expert: 4 };

/** One resource↔skill holding (mirrors a `resource_skill` record). */
export interface SkillHolding {
  resourceId: string;
  skillId: string;
  /** Proficiency token (novice…expert); unknown/absent ⇒ rank 0 (never satisfies a levelled requirement). */
  proficiency?: string | null;
}

/** One skill the portfolio requires. */
export interface SkillRequirement {
  skillId: string;
  /** Minimum proficiency that counts as qualified; absent ⇒ any holder qualifies (rank 0). */
  requiredLevel?: string | null;
  /** How many qualifying resources are needed. Coerced; floored at 0. Default 1. */
  requiredCount?: number | null;
}

export interface SkillsGapOptions {
  /** Proficiency token → ordinal rank (higher = more skilled). Default the shipped {@link PROFICIENCY_RANK}. */
  proficiencyRank?: Record<string, number>;
}

export interface SkillGap {
  skillId: string;
  /** The required proficiency token (null when any level qualifies). */
  requiredLevel: string | null;
  /** The resolved rank of {@link requiredLevel} (0 when any level qualifies). */
  requiredRank: number;
  /** Qualifying resources needed. */
  requiredCount: number;
  /** Distinct resources holding this skill at or above {@link requiredRank}. */
  supply: number;
  /** Distinct resources holding this skill at any level. */
  totalHolders: number;
  /** max(0, requiredCount − supply). */
  gap: number;
  /** supply / requiredCount, 2dp; null when requiredCount is 0. */
  coverage: number | null;
  /** True when there is no shortfall. */
  covered: boolean;
  /** Mean proficiency rank among holders; null when there are none. */
  meanProficiency: number | null;
}

export interface BenchSkill {
  skillId: string;
  holders: number;
}

export interface SkillsGapResult {
  /** Per required skill, worst-gap first (gap desc → coverage asc → skill id). */
  skills: SkillGap[];
  /** Skills held by someone but not in the requirements, most-held first. */
  bench: BenchSkill[];
  summary: {
    requiredSkills: number;
    coveredSkills: number;
    gapSkills: number;
    /** Sum of every skill's shortfall. */
    totalGap: number;
    /** Distinct resources across all holdings. */
    resources: number;
  };
}

/** Coerce a value to a stable string id (non-blank string, or a finite number), else null. */
function coerceId(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Cross resource-skill holdings against per-skill demand into a gap analysis. Deterministic, fail-closed,
 * empty ⇒ empty.
 */
export function analyzeSkillsGap(
  holdings: readonly SkillHolding[],
  requirements: readonly SkillRequirement[],
  options: SkillsGapOptions = {},
): SkillsGapResult {
  const rankMap = options?.proficiencyRank && typeof options.proficiencyRank === "object" ? options.proficiencyRank : (PROFICIENCY_RANK as Record<string, number>);
  const rankOf = (level: string | null | undefined): number => (typeof level === "string" && Object.prototype.hasOwnProperty.call(rankMap, level) ? Math.max(0, numLoose(rankMap[level])) : 0);

  // skillId → (resourceId → best rank held). A resource listed twice for a skill keeps its highest level.
  const bySkill = new Map<string, Map<string, number>>();
  const resources = new Set<string>();
  if (Array.isArray(holdings)) {
    for (const raw of holdings) {
      if (raw === null || typeof raw !== "object") continue;
      const h = raw as SkillHolding;
      const resourceId = coerceId(h.resourceId);
      const skillId = coerceId(h.skillId);
      if (resourceId === null || skillId === null) continue;
      resources.add(resourceId);
      const rank = rankOf(h.proficiency);
      let holders = bySkill.get(skillId);
      if (!holders) bySkill.set(skillId, (holders = new Map()));
      const prev = holders.get(resourceId);
      if (prev === undefined || rank > prev) holders.set(resourceId, rank);
    }
  }

  // Dedupe requirements by skill: keep the strictest (highest required rank, greatest required count).
  const reqBySkill = new Map<string, { level: string | null; rank: number; count: number }>();
  if (Array.isArray(requirements)) {
    for (const raw of requirements) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as SkillRequirement;
      const skillId = coerceId(r.skillId);
      if (skillId === null) continue;
      const level = typeof r.requiredLevel === "string" && r.requiredLevel.trim() ? r.requiredLevel : null;
      const rank = rankOf(level);
      const count = Math.max(0, Math.floor(optNum(r.requiredCount) ?? 1));
      const prev = reqBySkill.get(skillId);
      if (!prev) reqBySkill.set(skillId, { level, rank, count });
      else reqBySkill.set(skillId, { level: rank >= prev.rank ? level : prev.level, rank: Math.max(rank, prev.rank), count: Math.max(count, prev.count) });
    }
  }

  const skills: SkillGap[] = [];
  let coveredSkills = 0;
  let totalGap = 0;
  for (const [skillId, req] of reqBySkill) {
    const holders = bySkill.get(skillId) ?? new Map<string, number>();
    const ranks = [...holders.values()];
    const supply = ranks.filter((r) => r >= req.rank).length;
    const gap = Math.max(0, req.count - supply);
    const covered = gap === 0;
    if (covered) coveredSkills++;
    totalGap += gap;
    skills.push({
      skillId,
      requiredLevel: req.level,
      requiredRank: req.rank,
      requiredCount: req.count,
      supply,
      totalHolders: holders.size,
      gap,
      coverage: req.count > 0 ? round2(supply / req.count) : null,
      covered,
      meanProficiency: ranks.length ? round2(ranks.reduce((s, r) => s + r, 0) / ranks.length) : null,
    });
  }
  skills.sort((a, b) => {
    if (a.gap !== b.gap) return b.gap - a.gap;
    const ca = a.coverage ?? Infinity;
    const cb = b.coverage ?? Infinity;
    if (ca !== cb) return ca - cb;
    return byId(a.skillId, b.skillId);
  });

  const bench: BenchSkill[] = [...bySkill.entries()]
    .filter(([skillId]) => !reqBySkill.has(skillId))
    .map(([skillId, holders]) => ({ skillId, holders: holders.size }))
    .sort((a, b) => (b.holders !== a.holders ? b.holders - a.holders : byId(a.skillId, b.skillId)));

  return {
    skills,
    bench,
    summary: {
      requiredSkills: skills.length,
      coveredSkills,
      gapSkills: skills.length - coveredSkills,
      totalGap,
      resources: resources.size,
    },
  };
}
