import { useMemo } from "react";
import { planPi, type Dependency, type Load, type PiObjective, type Team, type TeamPlan } from "../../lib/pi-planning";
import { ReportTable, type ReportColumn } from "./ReportTable";

/**
 * SAFe PI-planning board — per-team load vs capacity across the PI's iterations (over-commitment
 * flagged red), the committed-vs-stretch business-value split, and the cross-team dependency count.
 * Presentational: it plans over whatever teams / load / objectives / dependencies it's given.
 * See lib/pi-planning.
 */
export function PiBoard({
  iterations,
  teams,
  load,
  objectives = [],
  dependencies = [],
}: {
  iterations: number;
  teams: Team[];
  load: Load[];
  objectives?: PiObjective[];
  dependencies?: Dependency[];
}) {
  const plan = useMemo(
    () => planPi({ iterations, teams, load, objectives, dependencies }),
    [iterations, teams, load, objectives, dependencies],
  );

  if (teams.length === 0) {
    return (
      <section className="border border-border p-3" data-testid="pi-board">
        <p className="text-xs text-muted-foreground" data-testid="pi-board-empty">No teams on the ART to plan.</p>
      </section>
    );
  }

  return (
    <section className="space-y-3 border border-border" data-testid="pi-board">
      <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
        <span className="font-bold text-sm">PI planning · {iterations} iterations</span>
        <span className="text-xs text-muted-foreground" data-testid="pi-commitment">
          {plan.commitment.committedPct}% BV committed ({plan.commitment.committedBusinessValue}/{plan.commitment.totalBusinessValue})
        </span>
      </div>

      <div className="px-3">
        <ReportTable
          rows={plan.teams}
          rowKey={(t) => t.teamId}
          rowTestId={(t) => `pi-team-${t.teamId}`}
          columns={[
            { header: "Team", cell: (t) => t.name, cellClassName: "font-bold" },
            ...Array.from({ length: iterations }, (_, i): ReportColumn<TeamPlan> => ({
              header: `Iter ${i + 1}`,
              align: "right",
              cell: (t) => `${t.iterations[i]!.plannedPoints}/${t.iterations[i]!.capacityPoints}`,
              cellClassName: (t) => (t.iterations[i]!.overloaded ? "text-red-500 font-black" : ""),
              testId: (t) => `pi-cell-${t.teamId}-${t.iterations[i]!.iteration}`,
            })),
            { header: "Load", align: "right", cell: (t) => `${t.loadPct}%`, cellClassName: (t) => `font-bold ${t.loadPct > 100 ? "text-red-500" : "text-muted-foreground"}` },
            {
              header: "Deps",
              align: "right",
              cellClassName: "text-muted-foreground",
              cell: (t) => {
                const dep = plan.dependencyLoad.find((d) => d.teamId === t.teamId)!;
                return `${dep.outgoing}→ ${dep.incoming}←`;
              },
            },
          ]}
        />
      </div>

      {plan.overCommittedTeams.length > 0 && (
        <p className="px-3 pb-2 text-[11px] text-red-500" data-testid="pi-overcommitted">
          Over-committed: {plan.overCommittedTeams.map((id) => plan.teams.find((t) => t.teamId === id)?.name ?? id).join(", ")} — rebalance before commit.
        </p>
      )}
      {plan.dependencies.some((d) => d.unresolved) && (
        <p className="px-3 pb-3 text-[11px] text-amber-600" data-testid="pi-unresolved-deps">
          {plan.dependencies.filter((d) => d.unresolved).length} dependency(ies) point off the ART — resolve the owning team.
        </p>
      )}
    </section>
  );
}
