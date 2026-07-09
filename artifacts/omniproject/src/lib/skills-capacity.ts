/**
 * Skills-based demand ↔ capacity — match role/skill-qualified supply against demand and surface the
 * unmet gap per skill. This is the depth the enterprise suites (Clarity, Planview) lead on: not just
 * "who's over-allocated" (Utilisation / ResourceHeatmap already do that) but "we need 400h of React at
 * ≥ level 3 next quarter and only have 250h qualified — a 150h gap". Skills aren't a canonical field,
 * so the caller sources the matrix from backend role/skill data or a config overlay; this module is
 * the pure, stateless matching engine over whatever it's given.
 */

/** A resource's skill proficiencies (1–5) + how many hours it can supply in the period. */
export interface ResourceSkills {
  resourceId: string;
  name: string;
  role?: string | null;
  /** skill → proficiency 1–5. */
  skills: Record<string, number>;
  capacityHours: number;
}

/** A demand request: an initiative needs `hoursNeeded` of a skill at ≥ `minProficiency`. */
export interface DemandRequest {
  id: string;
  initiative: string;
  skill: string;
  hoursNeeded: number;
  /** Minimum proficiency a resource needs to count as qualified (default 1 = any). */
  minProficiency?: number;
}

/** An allocation the matcher made: hours of one resource assigned to one demand request. */
export interface Allocation {
  requestId: string;
  resourceId: string;
  hours: number;
}

/** Per-skill supply/demand rollup. */
export interface SkillGap {
  skill: string;
  demandHours: number;
  /** Total capacity of resources qualified in this skill (at the request's proficiency bar). */
  qualifiedCapacityHours: number;
  /** Hours actually matched to qualified resources. */
  matchedHours: number;
  /** demand − matched, ≥ 0 — the shortfall. */
  unmetHours: number;
  /** matched ÷ demand × 100. */
  coveragePct: number;
  qualifiedResourceCount: number;
}

/** Per-resource load after matching. */
export interface ResourceLoad {
  resourceId: string;
  name: string;
  capacityHours: number;
  assignedHours: number;
  /** assigned − capacity, ≥ 0. */
  overAllocatedHours: number;
  utilisationPct: number;
}

export interface DemandCapacityResult {
  skills: SkillGap[];
  resources: ResourceLoad[];
  allocations: Allocation[];
  totals: { demandHours: number; matchedHours: number; unmetHours: number; coveragePct: number };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const prof = (r: ResourceSkills, skill: string): number => r.skills[skill] ?? 0;

/**
 * Match demand to qualified capacity. Greedy by request order, each request filled from its qualified
 * resources (proficiency ≥ bar) preferring HIGHER proficiency then MORE remaining capacity — so scarce
 * senior skills aren't wasted on work a junior could do when it doesn't matter. Pure + deterministic.
 */
export function matchDemandToCapacity(
  resources: readonly ResourceSkills[],
  demand: readonly DemandRequest[],
): DemandCapacityResult {
  const remaining = new Map<string, number>(resources.map((r) => [r.resourceId, r.capacityHours]));
  const allocations: Allocation[] = [];
  const matchedBySkill = new Map<string, number>();

  for (const req of demand) {
    const bar = req.minProficiency ?? 1;
    let need = Math.max(0, req.hoursNeeded);
    const qualified = resources
      .filter((r) => prof(r, req.skill) >= bar)
      .sort((a, b) => prof(b, req.skill) - prof(a, req.skill) || (remaining.get(b.resourceId)! - remaining.get(a.resourceId)!));
    for (const r of qualified) {
      if (need <= 0) break;
      const avail = remaining.get(r.resourceId)!;
      if (avail <= 0) continue;
      const take = Math.min(avail, need);
      remaining.set(r.resourceId, avail - take);
      need -= take;
      allocations.push({ requestId: req.id, resourceId: r.resourceId, hours: round1(take) });
      matchedBySkill.set(req.skill, (matchedBySkill.get(req.skill) ?? 0) + take);
    }
  }

  // Per-skill rollup (demand + qualified capacity at each skill's max requested bar).
  const skillBars = new Map<string, number>();
  const demandBySkill = new Map<string, number>();
  for (const req of demand) {
    demandBySkill.set(req.skill, (demandBySkill.get(req.skill) ?? 0) + Math.max(0, req.hoursNeeded));
    skillBars.set(req.skill, Math.max(skillBars.get(req.skill) ?? 1, req.minProficiency ?? 1));
  }
  const skills: SkillGap[] = [...demandBySkill.entries()]
    .map(([skill, demandHours]) => {
      const bar = skillBars.get(skill)!;
      const qualified = resources.filter((r) => prof(r, skill) >= bar);
      const matched = matchedBySkill.get(skill) ?? 0;
      return {
        skill,
        demandHours: round1(demandHours),
        qualifiedCapacityHours: round1(qualified.reduce((a, r) => a + r.capacityHours, 0)),
        matchedHours: round1(matched),
        unmetHours: round1(Math.max(0, demandHours - matched)),
        coveragePct: demandHours > 0 ? round1((matched / demandHours) * 100) : 100,
        qualifiedResourceCount: qualified.length,
      };
    })
    .sort((a, b) => b.unmetHours - a.unmetHours || a.skill.localeCompare(b.skill));

  const assignedByResource = new Map<string, number>();
  for (const a of allocations) assignedByResource.set(a.resourceId, (assignedByResource.get(a.resourceId) ?? 0) + a.hours);
  const resourceLoads: ResourceLoad[] = resources
    .map((r) => {
      const assigned = assignedByResource.get(r.resourceId) ?? 0;
      return {
        resourceId: r.resourceId,
        name: r.name,
        capacityHours: r.capacityHours,
        assignedHours: round1(assigned),
        overAllocatedHours: round1(Math.max(0, assigned - r.capacityHours)),
        utilisationPct: r.capacityHours > 0 ? round1((assigned / r.capacityHours) * 100) : 0,
      };
    })
    .sort((a, b) => b.utilisationPct - a.utilisationPct);

  const demandHours = round1(demand.reduce((a, r) => a + Math.max(0, r.hoursNeeded), 0));
  const matchedHours = round1(allocations.reduce((a, x) => a + x.hours, 0));
  return {
    skills,
    resources: resourceLoads,
    allocations,
    totals: {
      demandHours,
      matchedHours,
      unmetHours: round1(Math.max(0, demandHours - matchedHours)),
      coveragePct: demandHours > 0 ? round1((matchedHours / demandHours) * 100) : 100,
    },
  };
}
