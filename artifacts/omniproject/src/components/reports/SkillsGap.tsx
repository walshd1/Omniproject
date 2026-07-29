import { useMemo } from "react";
import { useListResourcePool, type ResourceMember } from "@workspace/api-client-react";
import { analyzeSkillsGap, type SkillHolding, type SkillRequirement } from "@workspace/backend-catalogue";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportEmpty } from "./ReportEmpty";

/**
 * Skills coverage — per-skill supply across the resource pool via the shared `analyzeSkillsGap` catalogue
 * engine. Each pool member's declared skills become holdings (one qualified holder each); the demand baseline
 * is one qualified holder per held skill, so a skill only one person carries reads as a single-point-of-failure
 * risk. Portfolio-wide (reads the whole resource pool; ignores project scope). Derive-only — nothing stored.
 */
export function SkillsGap() {
  const { data: members, isLoading, isError, error, refetch } = useListResourcePool();

  const { skills, bench, summary } = useMemo(() => {
    const pool = (members ?? []) as ResourceMember[];
    const holdings: SkillHolding[] = pool.flatMap((m) =>
      (Array.isArray(m.skills) ? m.skills : []).map((s) => ({ resourceId: m.id, skillId: s })),
    );
    // Baseline demand: every skill someone holds needs at least one qualified holder. This surfaces
    // single-point-of-failure skills (supply of 1) without an explicit demand feed.
    const requirements: SkillRequirement[] = [...new Set(holdings.map((h) => h.skillId))].map((skillId) => ({
      skillId,
      requiredCount: 1,
    }));
    return analyzeSkillsGap(holdings, requirements);
  }, [members]);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {skills.length === 0 ? (
        <ReportEmpty testId="skills-gap-empty">
          No skills declared yet — coverage builds from each resource-pool member&apos;s skills.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="skills-gap">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Skills" value={String(summary.requiredSkills)} />
            <StatCard label="Single-holder" value={String(summary.gapSkills)} />
            <StatCard label="Resources" value={String(summary.resources)} />
            <StatCard label="Bench skills" value={String(bench.length)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-black">Skill</th>
                  <th className="py-2 px-3 font-black tabular-nums text-right">Holders</th>
                  <th className="py-2 px-3 font-black tabular-nums text-right">Supply</th>
                  <th className="py-2 pl-3 font-black tabular-nums text-right">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <tr key={s.skillId} className="border-b border-border/40" data-testid={`skill-row-${s.skillId}`}>
                    <td className="py-2 pr-3 font-mono text-xs">{s.skillId}</td>
                    <td className="py-2 px-3 tabular-nums text-right">{s.totalHolders}</td>
                    <td className="py-2 px-3 tabular-nums text-right">{s.supply}</td>
                    <td className="py-2 pl-3 tabular-nums text-right">
                      {s.coverage == null ? "—" : `${Math.round(s.coverage * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Baseline demand is one qualified holder per held skill — a supply of 1 marks a single point of failure.
          </p>
        </div>
      )}
    </DataState>
  );
}
