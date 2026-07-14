import { useMemo } from "react";
import { matchDemandToCapacity, type DemandRequest, type ResourceSkills } from "../../lib/skills-capacity";
import { ReportTable } from "./ReportTable";

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

      <ReportTable
        rows={result.skills}
        rowKey={(s) => s.skill}
        rowTestId={(s) => `skill-row-${s.skill}`}
        columns={[
          {
            header: "Skill",
            cell: (s) => <>{s.skill} <span className="text-[10px] font-normal text-muted-foreground">· {s.qualifiedResourceCount} qualified</span></>,
            cellClassName: "font-bold",
          },
          { header: "Demand", align: "right", cell: (s) => `${s.demandHours}h` },
          { header: "Qualified cap.", align: "right", cell: (s) => `${s.qualifiedCapacityHours}h`, cellClassName: "text-muted-foreground" },
          { header: "Unmet", align: "right", cell: (s) => `${s.unmetHours}h`, cellClassName: (s) => `font-bold ${s.unmetHours > 0 ? "text-red-500" : "text-muted-foreground"}` },
          { header: "Coverage", align: "right", cell: (s) => `${s.coveragePct}%`, cellClassName: (s) => `font-black ${tone(s.coveragePct)}` },
        ]}
      />

      {result.resources.some((r) => r.overAllocatedHours > 0) && (
        <p className="text-[11px] text-amber-600" data-testid="skills-capacity-overallocated">
          Over-allocated: {result.resources.filter((r) => r.overAllocatedHours > 0).map((r) => `${r.name} (+${r.overAllocatedHours}h)`).join(", ")}
        </p>
      )}
    </section>
  );
}
