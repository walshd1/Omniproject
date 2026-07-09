/**
 * SAFe Program-Increment (PI) planning — the ART-level board Jira Align leads on: per-team load vs
 * capacity across the PI's iterations (over-commitment flagged), PI objectives split into committed vs
 * stretch business value, and a cross-team dependency board. Pure + stateless: it plans over whatever
 * teams / load / objectives / dependencies it's given; the plan itself is derived, nothing stored.
 */

/** A team on the ART, with its capacity (story points) for each iteration of the PI. */
export interface Team {
  id: string;
  name: string;
  /** Capacity in points per iteration; index === iteration number (0-based). */
  capacityByIteration: number[];
}

/** Planned load: a team commits `points` of work in an iteration. */
export interface Load {
  teamId: string;
  iteration: number;
  points: number;
}

/** A PI objective a team commits to (or takes as stretch), with its business value 1–10. */
export interface PiObjective {
  id: string;
  teamId: string;
  title: string;
  businessValue: number;
  /** Committed objectives count toward the ART's predictability; stretch is upside. */
  committed: boolean;
}

/** A cross-team dependency: `fromTeam` needs something from `toTeam`, optionally in an iteration. */
export interface Dependency {
  id: string;
  fromTeamId: string;
  toTeamId: string;
  label: string;
  iteration?: number;
}

export interface IterationLoad {
  iteration: number;
  plannedPoints: number;
  capacityPoints: number;
  overloaded: boolean;
}

export interface TeamPlan {
  teamId: string;
  name: string;
  iterations: IterationLoad[];
  totalPlanned: number;
  totalCapacity: number;
  overloadedIterations: number;
  loadPct: number;
}

export interface CommitmentSummary {
  committedBusinessValue: number;
  stretchBusinessValue: number;
  totalBusinessValue: number;
  committedPct: number;
}

export interface DependencyLoad {
  teamId: string;
  incoming: number;
  outgoing: number;
}

export interface PiPlan {
  iterations: number;
  teams: TeamPlan[];
  commitment: CommitmentSummary;
  /** Dependencies, flagged `unresolved` when either endpoint team isn't on the ART. */
  dependencies: (Dependency & { unresolved: boolean })[];
  dependencyLoad: DependencyLoad[];
  /** Teams over capacity in ≥1 iteration — the PI-planning risks to resolve. */
  overCommittedTeams: string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface PiPlanInput {
  iterations: number;
  teams: readonly Team[];
  load: readonly Load[];
  objectives?: readonly PiObjective[];
  dependencies?: readonly Dependency[];
}

/** Build the PI plan: per-team iteration load vs capacity, commitment split, dependency board. */
export function planPi(input: PiPlanInput): PiPlan {
  const { iterations, teams, load } = input;
  const teamIds = new Set(teams.map((t) => t.id));

  const loadByTeamIter = new Map<string, number>();
  for (const l of load) {
    if (l.iteration < 0 || l.iteration >= iterations) continue; // out-of-PI load ignored
    const key = `${l.teamId}#${l.iteration}`;
    loadByTeamIter.set(key, (loadByTeamIter.get(key) ?? 0) + Math.max(0, l.points));
  }

  const teamPlans: TeamPlan[] = teams.map((t) => {
    const iters: IterationLoad[] = [];
    for (let i = 0; i < iterations; i++) {
      const planned = loadByTeamIter.get(`${t.id}#${i}`) ?? 0;
      const capacity = t.capacityByIteration[i] ?? 0;
      iters.push({ iteration: i, plannedPoints: round1(planned), capacityPoints: capacity, overloaded: planned > capacity });
    }
    const totalPlanned = iters.reduce((a, x) => a + x.plannedPoints, 0);
    const totalCapacity = iters.reduce((a, x) => a + x.capacityPoints, 0);
    return {
      teamId: t.id,
      name: t.name,
      iterations: iters,
      totalPlanned: round1(totalPlanned),
      totalCapacity: round1(totalCapacity),
      overloadedIterations: iters.filter((x) => x.overloaded).length,
      loadPct: totalCapacity > 0 ? round1((totalPlanned / totalCapacity) * 100) : 0,
    };
  });

  const objectives = input.objectives ?? [];
  const committedBusinessValue = objectives.filter((o) => o.committed).reduce((a, o) => a + o.businessValue, 0);
  const stretchBusinessValue = objectives.filter((o) => !o.committed).reduce((a, o) => a + o.businessValue, 0);
  const totalBusinessValue = committedBusinessValue + stretchBusinessValue;

  const dependencies = (input.dependencies ?? []).map((d) => ({
    ...d,
    unresolved: !teamIds.has(d.fromTeamId) || !teamIds.has(d.toTeamId),
  }));
  const dependencyLoad: DependencyLoad[] = teams.map((t) => ({
    teamId: t.id,
    incoming: dependencies.filter((d) => d.toTeamId === t.id).length,
    outgoing: dependencies.filter((d) => d.fromTeamId === t.id).length,
  }));

  return {
    iterations,
    teams: teamPlans,
    commitment: {
      committedBusinessValue: round1(committedBusinessValue),
      stretchBusinessValue: round1(stretchBusinessValue),
      totalBusinessValue: round1(totalBusinessValue),
      committedPct: totalBusinessValue > 0 ? round1((committedBusinessValue / totalBusinessValue) * 100) : 0,
    },
    dependencies,
    dependencyLoad,
    overCommittedTeams: teamPlans.filter((tp) => tp.overloadedIterations > 0).map((tp) => tp.teamId),
  };
}
