import { describe, it, expect } from "vitest";
import { planPi, type Dependency, type Load, type PiObjective, type Team } from "./pi-planning";

const teams: Team[] = [
  { id: "t1", name: "Alpha", capacityByIteration: [20, 20, 20] },
  { id: "t2", name: "Bravo", capacityByIteration: [15, 15, 15] },
];

describe("planPi", () => {
  it("computes per-team iteration load vs capacity and flags over-commitment", () => {
    const load: Load[] = [
      { teamId: "t1", iteration: 0, points: 25 }, // over 20
      { teamId: "t1", iteration: 1, points: 10 },
      { teamId: "t2", iteration: 0, points: 15 }, // exactly capacity
    ];
    const plan = planPi({ iterations: 3, teams, load });
    const alpha = plan.teams.find((t) => t.teamId === "t1")!;
    expect(alpha.iterations[0]).toMatchObject({ plannedPoints: 25, capacityPoints: 20, overloaded: true });
    expect(alpha.iterations[1]!.overloaded).toBe(false);
    expect(alpha.overloadedIterations).toBe(1);
    expect(plan.overCommittedTeams).toEqual(["t1"]);
    const bravo = plan.teams.find((t) => t.teamId === "t2")!;
    expect(bravo.iterations[0]!.overloaded).toBe(false); // == capacity is not over
  });

  it("sums load per team+iteration and reports load %", () => {
    const load: Load[] = [
      { teamId: "t1", iteration: 0, points: 5 },
      { teamId: "t1", iteration: 0, points: 5 },
    ];
    const alpha = planPi({ iterations: 3, teams, load }).teams.find((t) => t.teamId === "t1")!;
    expect(alpha.iterations[0]!.plannedPoints).toBe(10);
    expect(alpha.totalPlanned).toBe(10);
    expect(alpha.totalCapacity).toBe(60);
    expect(alpha.loadPct).toBe(round1(10 / 60 * 100));
  });

  it("ignores load outside the PI's iterations", () => {
    const alpha = planPi({ iterations: 2, teams, load: [{ teamId: "t1", iteration: 5, points: 99 }] }).teams.find((t) => t.teamId === "t1")!;
    expect(alpha.totalPlanned).toBe(0);
  });

  it("splits objectives into committed vs stretch business value", () => {
    const objectives: PiObjective[] = [
      { id: "o1", teamId: "t1", title: "A", businessValue: 8, committed: true },
      { id: "o2", teamId: "t1", title: "B", businessValue: 5, committed: true },
      { id: "o3", teamId: "t2", title: "C", businessValue: 3, committed: false },
    ];
    const c = planPi({ iterations: 3, teams, load: [], objectives }).commitment;
    expect(c.committedBusinessValue).toBe(13);
    expect(c.stretchBusinessValue).toBe(3);
    expect(c.committedPct).toBe(round1(13 / 16 * 100));
  });

  it("builds the dependency board and flags unresolved endpoints", () => {
    const dependencies: Dependency[] = [
      { id: "d1", fromTeamId: "t1", toTeamId: "t2", label: "API" },
      { id: "d2", fromTeamId: "t1", toTeamId: "ghost", label: "Data" }, // ghost not on the ART
    ];
    const plan = planPi({ iterations: 3, teams, load: [], dependencies });
    expect(plan.dependencies.find((d) => d.id === "d1")!.unresolved).toBe(false);
    expect(plan.dependencies.find((d) => d.id === "d2")!.unresolved).toBe(true);
    const t2 = plan.dependencyLoad.find((d) => d.teamId === "t2")!;
    expect(t2.incoming).toBe(1);
    const t1 = plan.dependencyLoad.find((d) => d.teamId === "t1")!;
    expect(t1.outgoing).toBe(2);
  });
});

const round1 = (n: number): number => Math.round(n * 10) / 10;
