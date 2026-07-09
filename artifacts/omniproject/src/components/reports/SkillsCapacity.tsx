import { useMemo } from "react";
import { matchDemandToCapacity, type DemandRequest, type ResourceSkills } from "../../lib/skills-capacity";

/**
 * Skills demand ↔ capacity — the skill-level gap view (unmet hours by skill, over-allocation by
 * person) the enterprise suites lead on. Presentational: it matches whatever skills matrix + demand
 * it's given. Skills/demand aren't canonical fields, so a deployment sources them from backend role
 * data or a config overlay; with none, this renders an honest empty state. See lib/skills-capacity.
 */
function tone(coverage: number): string {
  if (coverage >= 100) return "text-green-600";
  if (coverage >= 75) return "text-amber-600";
  return "text-red-500";
}

export function SkillsCapacity({ resources, demand }: { resources: ResourceSkills[]; demand: DemandRequest[] }) {
  const result = useMemo(() => matchDemandToCapacity(resources, demand), [resources, demand]);

  if (demand.length === 0 || resources.length === 0) {
    return (
      <section className="border-t border-border pt-4" data-testid="skills-capacity">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground mb-1">Skills demand vs capacity</h3>
        <p className="text-xs text-muted-foreground" data-testid="skills-capacity-empty">
          No skills matrix or demand requests configured. Provide resource skills + role/skill demand to see the unmet-demand gap by skill.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3 border-t border-border pt-4" data-testid="skills-capacity">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Skills demand vs capacity</h3>
        <span className={`text-xs font-bold ${tone(result.totals.coveragePct)}`} data-testid="skills-capacity-coverage">
          {result.totals.coveragePct}% of demand met · {result.totals.unmetHours}h unmet
        </span>
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
            <th className="py-1.5 pr-3 font-bold">Skill</th>
            <th className="py-1.5 px-2 font-bold text-right">Demand</th>
            <th className="py-1.5 px-2 font-bold text-right">Qualified cap.</th>
            <th className="py-1.5 px-2 font-bold text-right">Unmet</th>
            <th className="py-1.5 px-2 font-bold text-right">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {result.skills.map((s) => (
            <tr key={s.skill} className="border-b border-border/50" data-testid={`skill-row-${s.skill}`}>
              <td className="py-1.5 pr-3 font-bold">{s.skill} <span className="text-[10px] font-normal text-muted-foreground">· {s.qualifiedResourceCount} qualified</span></td>
              <td className="py-1.5 px-2 text-right tabular-nums">{s.demandHours}h</td>
              <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{s.qualifiedCapacityHours}h</td>
              <td className={`py-1.5 px-2 text-right tabular-nums font-bold ${s.unmetHours > 0 ? "text-red-500" : "text-muted-foreground"}`}>{s.unmetHours}h</td>
              <td className={`py-1.5 px-2 text-right tabular-nums font-black ${tone(s.coveragePct)}`}>{s.coveragePct}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      {result.resources.some((r) => r.overAllocatedHours > 0) && (
        <p className="text-[11px] text-amber-600" data-testid="skills-capacity-overallocated">
          Over-allocated: {result.resources.filter((r) => r.overAllocatedHours > 0).map((r) => `${r.name} (+${r.overAllocatedHours}h)`).join(", ")}
        </p>
      )}
    </section>
  );
}
