import { ReportEmpty } from "./ReportEmpty";
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useListProjects, useGetCapabilities, getGetProjectCapacityQueryOptions, type ResourceCapacity } from "@workspace/api-client-react";
import { ArrowRightLeft, ShieldAlert } from "lucide-react";
import { rollupByProgramme, type ProjectCapacity } from "../../lib/capacity-rollup";
import { levelPortfolio, skillsSupplyDemand, simulateMove, type PersonLevelling, type SkillBalance, type MoveResult, type ResidencyPosture } from "../../lib/resource-levelling";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Cross-programme / cross-border resource LEVELLING. Built ON TOP of the existing capacity roll-up
 * (`rollupByProgramme` — unchanged, still the programme/portfolio summary) and the existing what-if
 * concurrency model's pattern (`resource-load.ts`'s base-vs-scenario shape): it adds the ACT-ON-IT
 * layer the roll-up doesn't have — who's over/under-allocated PORTFOLIO-WIDE across programme and
 * country boundaries, a simple skills supply-vs-demand balance, and a move/scenario what-if that shows
 * the before/after over/under-allocation delta on both sides of a modelled move. STATELESS: fetches
 * each project's capacity live and derives everything on the fly; the move action is a pure preview,
 * never written back to the broker.
 */

function programmeLabel(programmeId: string | null, projects: ProjectCapacity[]): string {
  if (programmeId === null) return "Standalone";
  return projects.find((p) => p.programmeId === programmeId)?.programmeName ?? programmeId;
}

function PersonRow({ p, projects }: { p: PersonLevelling; projects: ProjectCapacity[] }) {
  const over = p.totalAllocationPercentage > 100;
  return (
    <tr className="border-b border-border/50" data-testid={`levelling-person-${p.resourceId}`}>
      <td className="py-2 pr-3">
        <div className="font-bold">{p.resourceName}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{p.role}</div>
      </td>
      <td className="py-2 px-2 text-xs">
        {p.allocations.map((a) => (
          <div key={a.projectId} className="text-muted-foreground">{programmeLabel(a.programmeId, projects)} <span className="text-foreground/70">({a.projectName})</span></div>
        ))}
      </td>
      <td className="py-2 px-2 text-xs">
        {p.countries.length === 0 ? <span className="text-muted-foreground">—</span> : p.countries.join(", ")}
        {p.crossCountry && <span className="ml-1 text-amber-500" title="Spans more than one country">⚠</span>}
      </td>
      <td className={`py-2 px-2 text-right tabular-nums font-black ${over ? "text-red-500" : "text-foreground"}`}>{p.totalAllocationPercentage}%</td>
      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{p.totalAssignedHours.toLocaleString()}h / {p.totalAvailableHours.toLocaleString()}h</td>
    </tr>
  );
}

function SkillRow({ s }: { s: SkillBalance }) {
  const tone = s.pressure === "shortage" ? "text-red-500" : s.pressure === "surplus" ? "text-green-500" : "text-muted-foreground";
  return (
    <tr className="border-b border-border/50" data-testid={`levelling-skill-${s.skill}`}>
      <td className="py-1.5 pr-3 font-bold">{s.skill}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{s.supplyHeadcount}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{s.supplyAvailableHours.toLocaleString()}h</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{s.demandAssignedHours.toLocaleString()}h</td>
      <td className={`py-1.5 px-2 text-right tabular-nums font-black ${tone}`}>{s.balanceHours > 0 ? "+" : ""}{s.balanceHours}h</td>
      <td className={`py-1.5 px-2 text-right text-[10px] font-black uppercase tracking-widest ${tone}`}>{s.pressure}</td>
    </tr>
  );
}

function MoveSideCard({ label, side }: { label: string; side: MoveResult["from"] }) {
  return (
    <div className="border border-border p-3" data-testid={`levelling-move-side-${label.toLowerCase()}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">Utilisation</div>
          <div className="font-mono">{side.before.utilisation ?? "—"}% → <span className="font-black">{side.after.utilisation ?? "—"}%</span></div>
        </div>
        <div>
          <div className="text-muted-foreground">Over-allocated</div>
          <div className="font-mono">{side.before.overAllocated} → <span className="font-black">{side.after.overAllocated}</span></div>
        </div>
        <div>
          <div className="text-muted-foreground">Δ over-allocated</div>
          <div className={`font-mono font-black ${side.overAllocatedDelta > 0 ? "text-red-500" : side.overAllocatedDelta < 0 ? "text-green-500" : ""}`}>
            {side.overAllocatedDelta > 0 ? "+" : ""}{side.overAllocatedDelta}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResourceLevelling() {
  const { data: projectList, isLoading: projLoading, isError: projError, error: projErr, refetch } = useListProjects();
  const { data: caps } = useGetCapabilities();
  const ids = useMemo(() => (projectList ?? []).map((p) => p.id), [projectList]);

  // Same fan-out + stabilisation pattern as CapacityRollup — see docs/PERF-PATTERNS-REVIEW.md, Theme C.
  const capacityByProject = useQueries({
    queries: ids.map((id) => getGetProjectCapacityQueryOptions(id)),
    combine: (results) => ({
      data: results.map((r) => r.data as ResourceCapacity[] | undefined),
      isLoading: results.some((r) => r.isLoading),
    }),
  });
  const loading = projLoading || capacityByProject.isLoading;

  const projects: ProjectCapacity[] = useMemo(() => {
    return (projectList ?? []).map((p, i) => ({
      projectId: p.id,
      projectName: p.name,
      programmeId: p.programmeId ?? null,
      programmeName: p.programmeName ?? null,
      resources: capacityByProject.data[i] ?? [],
    }));
  }, [projectList, capacityByProject]);

  const rollup = useMemo(() => rollupByProgramme(projects), [projects]);
  const levelling = useMemo(() => levelPortfolio(projects), [projects]);
  const skills = useMemo(() => skillsSupplyDemand(projects), [projects]);
  // Memoise: when residency is unconfigured, `?? { … }` yields a fresh literal each render, which would
  // re-run the whole-portfolio simulateMove memo below on every render (broken-memo thrash).
  const posture: ResidencyPosture = useMemo(() => caps?.residency ?? { enabled: false, allowedRegions: [] }, [caps?.residency]);

  const [resourceId, setResourceId] = useState<string>("");
  const [fromProjectId, setFromProjectId] = useState<string>("");
  const [toProjectId, setToProjectId] = useState<string>("");
  const [movePercentage, setMovePercentage] = useState<number>(20);

  const move: MoveResult | null = useMemo(() => {
    if (!resourceId || !fromProjectId || !toProjectId) return null;
    return simulateMove(projects, { resourceId, fromProjectId, toProjectId, movePercentage }, posture);
  }, [projects, resourceId, fromProjectId, toProjectId, movePercentage, posture]);

  const hasData = rollup.portfolio.allocations > 0;

  return (
    <DataState isLoading={loading} isError={projError} error={projErr} onRetry={() => refetch()} className="min-h-40">
      {!hasData ? (
        <ReportEmpty testId="levelling-empty">
          No capacity data — connect a resource-management source so the levelling view has allocations to work with.
        </ReportEmpty>
      ) : (
        <div className="space-y-6" data-testid="resource-levelling">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="People tracked" value={levelling.people.length.toLocaleString()} hint="across the portfolio" />
            <StatCard label="Over-allocated" value={levelling.overAllocated.length.toLocaleString()} hint="portfolio-wide total > 100%" />
            <StatCard label="Lend candidates" value={levelling.underAllocated.length.toLocaleString()} hint="spare capacity to borrow" />
            <StatCard label="Cross-country" value={levelling.people.filter((p) => p.crossCountry).length.toLocaleString()} hint="allocated across >1 country" />
          </div>

          {posture.enabled && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground border border-border p-2" data-testid="levelling-residency-banner">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              Data-residency enforcement is on — allowed regions: {posture.allowedRegions.length ? posture.allowedRegions.join(", ") : "none"}.
              A modelled move for a resource outside this set (or with no declared country) is blocked below.
            </div>
          )}

          {/* Per-person portfolio-wide levelling — the roll-up's per-project view can't show this. */}
          <div className="overflow-x-auto">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">People — over/under-allocated across programme &amp; country</div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Person</th>
                  <th className="py-1.5 px-2 font-bold">Programmes / projects</th>
                  <th className="py-1.5 px-2 font-bold">Country</th>
                  <th className="py-1.5 px-2 font-bold text-right">Total alloc.</th>
                  <th className="py-1.5 px-2 font-bold text-right">Hours</th>
                </tr>
              </thead>
              <tbody>
                {[...levelling.overAllocated, ...levelling.underAllocated].map((p) => <PersonRow key={p.resourceId} p={p} projects={projects} />)}
                {levelling.overAllocated.length === 0 && levelling.underAllocated.length === 0 && (
                  <tr><td colSpan={5} className="py-3 text-muted-foreground">Nobody is over- or under-allocated portfolio-wide — capacity is level.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Skills supply vs demand — a simple tag balance, not a taxonomy system. */}
          <div className="overflow-x-auto">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Skills supply vs demand</div>
            {skills.length === 0 ? (
              <div className="bg-card border border-dashed border-border p-4 text-center text-xs text-muted-foreground" data-testid="levelling-skills-empty">
                No skills declared by the connected backend — nothing to balance yet.
              </div>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                    <th className="py-1.5 pr-3 font-bold">Skill</th>
                    <th className="py-1.5 px-2 font-bold text-right">Headcount</th>
                    <th className="py-1.5 px-2 font-bold text-right">Supply</th>
                    <th className="py-1.5 px-2 font-bold text-right">Demand</th>
                    <th className="py-1.5 px-2 font-bold text-right">Balance</th>
                    <th className="py-1.5 px-2 font-bold text-right">Pressure</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((s) => <SkillRow key={s.skill} s={s} />)}
                </tbody>
              </table>
            )}
          </div>

          {/* Move / scenario what-if — mirrors ScenarioSandbox: forked local state, nothing written back. */}
          <div className="bg-card border border-border p-4 space-y-4" data-testid="levelling-move-sandbox">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Model a move</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
              <label className="flex flex-col gap-1">
                <span className="font-black uppercase tracking-widest text-muted-foreground">Person</span>
                <Select value={resourceId} onValueChange={setResourceId}>
                  <SelectTrigger aria-label="Person to move" className="rounded-none bg-background border-border" data-testid="levelling-move-resource"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent className="rounded-none border-border">
                    {levelling.people.map((p) => <SelectItem key={p.resourceId} value={p.resourceId}>{p.resourceName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-black uppercase tracking-widest text-muted-foreground">From project</span>
                <Select value={fromProjectId} onValueChange={setFromProjectId}>
                  <SelectTrigger aria-label="Origin project" className="rounded-none bg-background border-border" data-testid="levelling-move-from"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent className="rounded-none border-border">
                    {projects.map((p) => <SelectItem key={p.projectId} value={p.projectId}>{p.projectName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-black uppercase tracking-widest text-muted-foreground">To project</span>
                <Select value={toProjectId} onValueChange={setToProjectId}>
                  <SelectTrigger aria-label="Destination project" className="rounded-none bg-background border-border" data-testid="levelling-move-to"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent className="rounded-none border-border">
                    {projects.map((p) => <SelectItem key={p.projectId} value={p.projectId}>{p.projectName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-black uppercase tracking-widest text-muted-foreground">Move %</span>
                <input
                  type="number" min={0} max={100} value={movePercentage}
                  aria-label="Percentage points to move"
                  onChange={(e) => setMovePercentage(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  className="px-2 py-1.5 bg-background border border-border font-mono outline-none focus:border-primary"
                  data-testid="levelling-move-percentage"
                />
              </label>
            </div>

            {move && (
              <div className="space-y-3" data-testid="levelling-move-result">
                {!move.allowed ? (
                  <div role="alert" className="flex items-center gap-2 border border-red-500/50 bg-red-500/5 p-3 text-xs text-red-600" data-testid="levelling-move-blocked">
                    <ShieldAlert className="w-4 h-4 shrink-0" /> Move blocked: {move.reason}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <MoveSideCard label="From" side={move.from} />
                    <MoveSideCard label="To" side={move.to} />
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              This is a <strong>what-if</strong> only — it forks the live roll-up in the browser and is never written back
              to any backend. Choose a person and the origin/destination project to preview the over/under-allocation
              impact on both programmes before acting on it in your PM tool.
            </p>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Built on the capacity roll-up: over-allocation here is a person's allocation SUMMED across every
            project they touch (portfolio-wide), which a single project's view can't show. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
