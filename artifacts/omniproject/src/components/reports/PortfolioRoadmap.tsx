import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useListProjects,
  getGetProjectIssuesQueryOptions,
  type Issue,
} from "@workspace/api-client-react";
import { buildRoadmap, pct, type RoadmapProject, type RoadmapBar } from "../../lib/roadmap";
import { DataState } from "../DataState";

/**
 * Portfolio Roadmap report. STATELESS: it reads the existing projects and their issues
 * and *derives* a cross-programme timeline on the fly —
 * each project becomes a bar spanning the earliest start … latest due of its work items,
 * grouped into programme swimlanes. Nothing is stored. A project with no dated work simply
 * can't be placed and is reported in the footnote rather than silently dropped.
 */

const DAY_MS = 86_400_000;

/** Axis ticks at the first of each month (quarterly once the span is long), in UTC for determinism. */
function buildTicks(min: number, max: number): { at: number; label: string }[] {
  if (max <= min) return [];
  const spanMonths = (max - min) / (DAY_MS * 30);
  const step = spanMonths > 18 ? 3 : 1;
  const ticks: { at: number; label: string }[] = [];
  const cur = new Date(min);
  cur.setUTCDate(1);
  cur.setUTCHours(0, 0, 0, 0);
  if (cur.getTime() < min) cur.setUTCMonth(cur.getUTCMonth() + 1);
  while (cur.getTime() <= max && ticks.length < 60) {
    ticks.push({
      at: cur.getTime(),
      label: cur.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }),
    });
    cur.setUTCMonth(cur.getUTCMonth() + step);
  }
  return ticks;
}

function fmt(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function Bar({ bar, min, max }: { bar: RoadmapBar; min: number; max: number }) {
  const left = pct(bar.start, min, max);
  const width = Math.max(1.5, pct(bar.end, min, max) - left);
  const donePct = Math.round(bar.completionRate * 100);
  return (
    <div className="relative h-7" data-testid={`roadmap-bar-${bar.projectId}`}>
      <div
        className="absolute top-0 h-7 border border-primary/60 bg-primary/15 overflow-hidden"
        style={{ left: `${left}%`, width: `${width}%`, minWidth: "2px" }}
        title={`${bar.projectName} · ${fmt(bar.start)} → ${fmt(bar.end)} · ${donePct}% complete`}
      >
        <div className="h-full bg-primary/45" style={{ width: `${donePct}%` }} />
        <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-bold uppercase tracking-wide truncate text-foreground">
          {bar.projectName}
        </span>
      </div>
    </div>
  );
}

export function PortfolioRoadmap() {
  const { data: projects, isLoading, isError, error, refetch } = useListProjects();

  // One issues query per project (canonical key ⇒ shared with the rest of the app's cache).
  const issueQueries = useQueries({
    queries: (projects ?? []).map((p) => getGetProjectIssuesQueryOptions(p.id)),
  });

  const issuesLoading = issueQueries.some((q) => q.isLoading);

  const roadmap = useMemo(() => {
    const list: RoadmapProject[] = (projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      programmeId: p.programmeId,
      programmeName: p.programmeName,
      issueCount: p.issueCount,
      completedCount: p.completedCount,
    }));
    const byProject: Record<string, Issue[]> = {};
    (projects ?? []).forEach((p, i) => {
      byProject[p.id] = (issueQueries[i]?.data as Issue[] | undefined) ?? [];
    });
    return buildRoadmap(list, byProject);
  }, [projects, issueQueries]);

  const ticks = useMemo(() => buildTicks(roadmap.min, roadmap.max), [roadmap.min, roadmap.max]);
  const now = Date.now();
  const todayPct = now >= roadmap.min && now <= roadmap.max ? pct(now, roadmap.min, roadmap.max) : null;
  const excluded = roadmap.totalProjects - roadmap.datedProjects;
  const placedText = `${roadmap.datedProjects} of ${roadmap.totalProjects} projects placed`;
  const excludedText = excluded > 0 ? ` · ${excluded} without dated work ${excluded === 1 ? "is" : "are"} not shown` : "";

  return (
    <DataState isLoading={isLoading || issuesLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {roadmap.datedProjects === 0 ? (
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="roadmap-empty">
          No scheduled work to place on a timeline — add start/due dates to work items to see the portfolio roadmap.
        </div>
      ) : (
        <div className="space-y-3" data-testid="portfolio-roadmap">
          {/* Time axis */}
          <div className="relative h-5 ml-44 border-b border-border">
            {ticks.map((t) => (
              <span
                key={t.at}
                className="absolute -translate-x-1/2 text-[10px] font-mono text-muted-foreground"
                style={{ left: `${pct(t.at, roadmap.min, roadmap.max)}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>

          {roadmap.lanes.map((lane) => (
            <div key={lane.key} className="space-y-1" data-testid={`roadmap-lane-${lane.key}`}>
              <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{lane.name}</div>
              {lane.bars.map((bar) => (
                <div key={bar.projectId} className="flex items-center gap-2">
                  <div className="w-44 shrink-0 truncate text-xs font-mono" title={bar.projectName}>{bar.projectName}</div>
                  <div className="relative flex-1">
                    {todayPct !== null && (
                      <div className="absolute top-0 bottom-0 w-px bg-red-500/70 z-10" style={{ left: `${todayPct}%` }} aria-hidden="true" />
                    )}
                    <Bar bar={bar} min={roadmap.min} max={roadmap.max} />
                  </div>
                </div>
              ))}
            </div>
          ))}

          <p className="text-[11px] text-muted-foreground pt-1">
            {placedText}{excludedText} · bars span each project's earliest start to latest due (derived, nothing stored)
            {todayPct !== null ? " · the red line marks today." : "."}
          </p>
        </div>
      )}
    </DataState>
  );
}
