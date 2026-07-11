import { useMemo } from "react";
import { planPi, type Dependency, type Load, type PiObjective, type Team } from "../../lib/pi-planning";

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

      <div className="overflow-x-auto px-3">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
              <th className="py-1.5 pr-3 font-bold">Team</th>
              {Array.from({ length: iterations }, (_, i) => <th key={i} className="py-1.5 px-2 font-bold text-right">Iter {i + 1}</th>)}
              <th className="py-1.5 px-2 font-bold text-right">Load</th>
              <th className="py-1.5 px-2 font-bold text-right">Deps</th>
            </tr>
          </thead>
          <tbody>
            {plan.teams.map((t) => {
              const dep = plan.dependencyLoad.find((d) => d.teamId === t.teamId)!;
              return (
                <tr key={t.teamId} className="border-b border-border/50" data-testid={`pi-team-${t.teamId}`}>
                  <td className="py-1.5 pr-3 font-bold">{t.name}</td>
                  {t.iterations.map((it) => (
                    <td key={it.iteration} className={`py-1.5 px-2 text-right tabular-nums ${it.overloaded ? "text-red-500 font-black" : ""}`}
                      data-testid={`pi-cell-${t.teamId}-${it.iteration}`}>
                      {it.plannedPoints}/{it.capacityPoints}
                    </td>
                  ))}
                  <td className={`py-1.5 px-2 text-right tabular-nums font-bold ${t.loadPct > 100 ? "text-red-500" : "text-muted-foreground"}`}>{t.loadPct}%</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{dep.outgoing}→ {dep.incoming}←</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
