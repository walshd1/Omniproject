import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProjectIssues,
  useUpdateIssue,
  useGetCapabilities,
  getGetProjectIssuesQueryKey,
  getGetProjectSummaryQueryKey,
  type Issue,
  type IssueUpdate,
} from "@workspace/api-client-react";
import { STATUS_COLORS, STATUS_LABELS } from "../../lib/constants";
import { isTerminal } from "../../lib/status-vocab";
import { canStoreField } from "../../lib/capabilities-fields";
import { rescheduledDates } from "../../lib/reschedule";
import { DAY_MS, dayToShortDate } from "../../lib/date-utils";
import { loadEdges, type DependencyType } from "../../lib/dependencies";
import {
  useProjectDependencies,
  useWriteProjectDependency,
  useRemoveProjectDependency,
  projectDependenciesQueryKey,
  dependencyRowId,
  type DependencyRow,
} from "../../lib/project-dependencies";
import { useSchedulingSettings } from "../../lib/scheduling-settings";
import { computeCascade } from "../../lib/cascade-reschedule";
import { useToast } from "@/hooks/use-toast";
import { IssueDialog } from "../IssueDialog";
import { LoadingState } from "../LoadingState";
import { DataState } from "../DataState";

function startOfDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

interface Lane {
  issue: Issue;
  startDay: number;
  endDay: number;
}

export function GanttChart({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId);
  const { data: caps } = useGetCapabilities();
  const queryClient = useQueryClient();
  const updateIssue = useUpdateIssue();
  const { toast } = useToast();
  const { hoursPerDay, calendar } = useSchedulingSettings();
  // Durable brokered edges (SoR-provided or sidecar, §5.5) merged with the volatile overlay so a cascade
  // honours the real dependency graph, not just this session's ad-hoc links.
  const { data: brokeredEdges } = useProjectDependencies(projectId);
  const writeDependency = useWriteProjectDependency(projectId);
  const removeDependency = useRemoveProjectDependency(projectId);
  const [editing, setEditing] = useState<Issue | null>(null);
  // Link-editing mode: which issue we're drawing a dependency FROM (null = not linking).
  // Click a source's "→" handle to start, then a target's "＋" handle to finish.
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  // Opt-in: when on, dragging a bar cascades its dependents (via the scheduling
  // engine) and writes each moved item back too. Off = the default single-bar move.
  const [cascade, setCascade] = useState(false);
  // Live drag state: which bar, how many days it's been nudged, and a transient
  // ref for the in-flight gesture (start x, px-per-day, did-it-move).
  const [drag, setDrag] = useState<{ id: string; deltaDays: number } | null>(null);
  const gesture = useRef<{ id: string; startX: number; pxPerDay: number; moved: boolean } | null>(null);

  // Drag-to-reschedule is a write, so it's gated on the backend being able to
  // STORE the schedule dates. When it can't, bars stay click-to-open (the dialog
  // shows the dates read-only). Both ends move together, so both must be storable.
  const canReschedule = canStoreField(caps, "startDate") && canStoreField(caps, "dueDate");

  const commitReschedule = (issue: Issue, deltaDays: number) => {
    if (deltaDays === 0) return;
    const dates = rescheduledDates(issue, deltaDays);
    const data: IssueUpdate = { ...dates, ...(issue.version != null ? { expectedVersion: issue.version } : {}) };
    const key = getGetProjectIssuesQueryKey(projectId);
    const prev = queryClient.getQueryData<Issue[]>(key);
    // Optimistic: move the bar in the cache immediately.
    queryClient.setQueryData<Issue[]>(key, (old) =>
      (old ?? []).map((i) => (i.id === issue.id ? { ...i, ...dates } : i)),
    );
    updateIssue.mutate(
      { projectId, issueId: issue.id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: key });
          queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
          toast({ title: "RESCHEDULED", description: `${issue.title} · ${deltaDays > 0 ? "+" : ""}${deltaDays}d` });
        },
        onError: (err) => {
          if (prev) queryClient.setQueryData(key, prev); // revert the optimistic move
          const conflict = (err as { status?: number }).status === 409;
          queryClient.invalidateQueries({ queryKey: key });
          toast({
            title: conflict ? "EDIT CONFLICT" : "ERROR",
            description: conflict
              ? "This issue was changed by someone else — the timeline has been refreshed."
              : "Couldn't reschedule. The timeline has been refreshed.",
            variant: "destructive",
          });
        },
      },
    );
  };

  /** Cascade commit: write the dragged bar AND every dependent the engine pushed, all at once, with a
   *  single optimistic move and an all-or-revert failure path (any write failing rolls the timeline back). */
  const commitCascade = async (shifts: Map<string, number>) => {
    if (shifts.size === 0) return;
    const key = getGetProjectIssuesQueryKey(projectId);
    const prev = queryClient.getQueryData<Issue[]>(key);
    const byId = new Map((prev ?? []).map((i) => [i.id, i]));
    // Optimistic: move every affected bar in the cache immediately.
    queryClient.setQueryData<Issue[]>(key, (old) =>
      (old ?? []).map((i) => {
        const s = shifts.get(i.id);
        return s ? { ...i, ...rescheduledDates(i, s) } : i;
      }),
    );
    try {
      await Promise.all(
        [...shifts].map(([id, s]) => {
          const target = byId.get(id);
          if (!target) return Promise.resolve();
          const data: IssueUpdate = { ...rescheduledDates(target, s), ...(target.version != null ? { expectedVersion: target.version } : {}) };
          return updateIssue.mutateAsync({ projectId, issueId: id, data });
        }),
      );
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
      toast({ title: "RESCHEDULED", description: `${shifts.size} item${shifts.size > 1 ? "s" : ""} cascaded` });
    } catch (err) {
      if (prev) queryClient.setQueryData(key, prev); // revert every optimistic move together
      queryClient.invalidateQueries({ queryKey: key });
      const conflict = (err as { status?: number }).status === 409;
      toast({
        title: conflict ? "EDIT CONFLICT" : "ERROR",
        description: conflict
          ? "An item was changed by someone else — the timeline has been refreshed."
          : "Couldn't cascade the reschedule. The timeline has been refreshed.",
        variant: "destructive",
      });
    }
  };

  const titleOf = (id: string) => (issues ?? []).find((i) => i.id === id)?.title ?? id;

  /** Optimistically mutate the durable-dependency cache (raw `{rows}` shape the read query holds), returning the
   *  prior snapshot so a failed write can revert — same discipline as commitReschedule. */
  const patchDepCache = (fn: (rows: DependencyRow[]) => DependencyRow[]): { rows: DependencyRow[] } | undefined => {
    const key = projectDependenciesQueryKey(projectId);
    const prev = queryClient.getQueryData<{ rows: DependencyRow[] }>(key);
    queryClient.setQueryData<{ rows: DependencyRow[] }>(key, (old) => ({ rows: fn(old?.rows ?? []) }));
    return prev;
  };

  const rowKey = (r: DependencyRow) => r.id ?? dependencyRowId(r.fromId, r.kind, r.toId);

  /** Create a finish-to-start precedence edge (from precedes to). Durable via the generic `dependencies` slot;
   *  contributor+ is enforced server-side, so a 403/500 reverts the optimistic add and refreshes. */
  const createLink = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    const kind: DependencyType = "blocks";
    const id = dependencyRowId(fromId, kind, toId);
    const prev = patchDepCache((rows) =>
      rows.some((r) => rowKey(r) === id) ? rows : [...rows, { id, fromId, toId, kind }],
    );
    writeDependency.mutate(
      { fromId, toId, kind },
      {
        onSuccess: () => toast({ title: "LINKED", description: `${titleOf(fromId)} → ${titleOf(toId)}` }),
        onError: (err) => {
          if (prev) queryClient.setQueryData(projectDependenciesQueryKey(projectId), prev);
          queryClient.invalidateQueries({ queryKey: projectDependenciesQueryKey(projectId) });
          const conflict = (err as { status?: number }).status === 409;
          toast({
            title: conflict ? "EDIT CONFLICT" : "ERROR",
            description: "Couldn't add the dependency. The graph has been refreshed.",
            variant: "destructive",
          });
        },
      },
    );
  };

  /** Remove a durable edge (click on its arrow). Optimistic drop + revert-on-error. */
  const removeLink = (fromId: string, toId: string, kind: DependencyType) => {
    const id = dependencyRowId(fromId, kind, toId);
    const prev = patchDepCache((rows) => rows.filter((r) => rowKey(r) !== id));
    removeDependency.mutate(
      { fromId, toId, kind },
      {
        onSuccess: () => toast({ title: "UNLINKED", description: `${titleOf(fromId)} → ${titleOf(toId)}` }),
        onError: () => {
          if (prev) queryClient.setQueryData(projectDependenciesQueryKey(projectId), prev);
          queryClient.invalidateQueries({ queryKey: projectDependenciesQueryKey(projectId) });
          toast({ title: "ERROR", description: "Couldn't remove the dependency. The graph has been refreshed.", variant: "destructive" });
        },
      },
    );
  };

  const model = useMemo(() => {
    const scheduled = (issues ?? []).filter((i) => i.startDate || i.dueDate);
    if (scheduled.length === 0) return null;

    const lanes: Lane[] = scheduled.map((issue) => {
      const start = issue.startDate ? new Date(issue.startDate) : new Date(issue.dueDate!);
      const end = issue.dueDate ? new Date(issue.dueDate) : new Date(issue.startDate!);
      let s = startOfDay(start);
      let e = startOfDay(end);
      if (e < s) [s, e] = [e, s];
      return { issue, startDay: s, endDay: e };
    });

    lanes.sort((a, b) => a.startDay - b.startDay);

    // Single pass for the range (lanes is non-empty here) — avoids two spread allocations.
    let min = Infinity;
    let max = -Infinity;
    for (const l of lanes) {
      if (l.startDay < min) min = l.startDay;
      if (l.endDay > max) max = l.endDay;
    }
    const span = Math.max(max - min + 1, 1);
    const today = startOfDay(new Date());

    return { lanes, min, max, span, today };
  }, [issues]);

  if (isError) {
    return <DataState isError error={error} onRetry={() => refetch()}>{null}</DataState>;
  }

  if (isLoading) {
    return <LoadingState />;
  }

  if (!model) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-card border border-border text-muted-foreground font-bold p-6 text-center uppercase tracking-wider">
        No scheduled issues. Add start / due dates to see the timeline.
      </div>
    );
  }

  const { lanes, min, span, today } = model;
  const fmt = dayToShortDate;
  const todayPct = today >= min && today <= min + span ? ((today - min) / span) * 100 : null;

  // Dependency arrows. Both endpoints of a durable edge live in THIS project, so an edge is drawable only when
  // both are scheduled lanes (an unscheduled endpoint has no bar to point at). Row height matches the bar cell
  // (h-12 = 48px) plus the 1px bottom border; x is a percentage of the track (the SVG overlays the track region,
  // so a line's x% matches a bar's left%), y is the pixel centre of each row.
  const ROW_H = 49;
  const laneIndexById = new Map(lanes.map((l, i) => [l.issue.id, i]));
  const links = (brokeredEdges ?? [])
    .map((e) => ({ fromId: e.from.itemRef, toId: e.to.itemRef, kind: e.type }))
    .filter((l) => l.fromId !== l.toId && laneIndexById.has(l.fromId) && laneIndexById.has(l.toId));

  return (
    <>
      <div className="h-full overflow-auto bg-card border border-border">
        <div className="min-w-[720px]">
          {/* Header / axis */}
          <div className="flex items-center border-b border-border bg-background sticky top-0 z-10">
            <div className="w-64 shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground border-r border-border">
              Issue
            </div>
            <div className="flex-1 px-4 py-2 flex items-center gap-4 text-xs font-mono text-muted-foreground">
              <span>{fmt(min)}</span>
              <span className="flex-1 text-right">{fmt(min + span - 1)}</span>
              {canReschedule && (
                <label
                  className="flex items-center gap-1.5 font-sans normal-case cursor-pointer select-none whitespace-nowrap"
                  title="When on, dragging a bar reschedules the dependents it pushes too — a working-calendar cascade written back to your backend."
                >
                  <input
                    type="checkbox"
                    data-testid="gantt-cascade-toggle"
                    className="accent-primary"
                    checked={cascade}
                    onChange={(e) => setCascade(e.target.checked)}
                  />
                  Cascade dependents
                </label>
              )}
            </div>
          </div>

          {/* Rows */}
          <div className="relative">
            {todayPct !== null && (
              <div
                className="absolute top-0 bottom-0 w-px bg-primary/70 z-0"
                style={{ left: `calc(16rem + ${todayPct}% )` }}
                title="Today"
              />
            )}
            {/* Dependency arrows overlay — spans the track (offset past the 16rem label column). The container is
                pointer-events-none so it never blocks bar drags; only each arrow's transparent hit-line is clickable
                (to remove that edge). x uses viewport-%, y uses px, so nothing is distorted. */}
            {links.length > 0 && (
              <div className="pointer-events-none absolute top-0 bottom-0 z-[5]" style={{ left: "16rem", right: 0 }}>
                <svg width="100%" height="100%" aria-hidden="false">
                  <defs>
                    <marker id="gantt-dep-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
                    </marker>
                  </defs>
                  {links.map(({ fromId, toId, kind }) => {
                    const si = laneIndexById.get(fromId)!;
                    const ti = laneIndexById.get(toId)!;
                    const s = lanes[si]!;
                    const t = lanes[ti]!;
                    const rel = kind === "relates_to";
                    // Precedence (blocks/depends_on) draws source-END → target-START (finish-to-start); a loose
                    // relates_to draws centre → centre so it reads differently.
                    const x1 = rel ? ((s.startDay + s.endDay) / 2 - min + 0.5) / span * 100 : (s.endDay - min + 1) / span * 100;
                    const x2 = rel ? ((t.startDay + t.endDay) / 2 - min + 0.5) / span * 100 : (t.startDay - min) / span * 100;
                    const y1 = si * ROW_H + ROW_H / 2;
                    const y2 = ti * ROW_H + ROW_H / 2;
                    return (
                      <g key={`${fromId}__${kind}__${toId}`} className="text-primary/70">
                        <line
                          x1={`${x1}%`} y1={y1} x2={`${x2}%`} y2={y2}
                          stroke="currentColor" strokeWidth={1.5}
                          markerEnd="url(#gantt-dep-arrow)"
                          {...(rel ? { strokeDasharray: "4 3" } : {})}
                        />
                        <line
                          x1={`${x1}%`} y1={y1} x2={`${x2}%`} y2={y2}
                          stroke="transparent" strokeWidth={12}
                          className="pointer-events-auto cursor-pointer"
                          data-testid={`gantt-link-${fromId}-${toId}`}
                          role="button"
                          aria-label={`Remove dependency ${titleOf(fromId)} → ${titleOf(toId)}`}
                          onClick={() => removeLink(fromId, toId, kind)}
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>
            )}
            {lanes.map(({ issue, startDay, endDay }) => {
                const nudged = drag?.id === issue.id ? drag.deltaDays : 0;
                const offsetPct = ((startDay - min + nudged) / span) * 100;
                const widthPct = Math.max(((endDay - startDay + 1) / span) * 100, 2);
                const overdue = endDay < today && !isTerminal(issue.status);
                const moving = updateIssue.isPending;
                return (
                  <div key={issue.id} className="flex items-center border-b border-border hover:bg-muted/20 group">
                    <div className="w-64 shrink-0 flex items-center border-r border-border">
                      <button
                        onClick={() => setEditing(issue)}
                        className="flex-1 min-w-0 px-4 py-3 text-left truncate text-sm font-semibold group-hover:text-primary"
                        title={issue.title}
                      >
                        {issue.title}
                      </button>
                      {linkingFrom == null ? (
                        <button
                          data-testid={`gantt-link-start-${issue.id}`}
                          aria-label={`Start a dependency from ${issue.title}`}
                          title="Draw a dependency from this issue, then click a target"
                          onClick={() => setLinkingFrom(issue.id)}
                          className="shrink-0 px-2 py-3 text-muted-foreground hover:text-primary font-bold"
                        >
                          →
                        </button>
                      ) : linkingFrom === issue.id ? (
                        <button
                          data-testid={`gantt-link-cancel-${issue.id}`}
                          aria-label="Cancel linking"
                          title="Cancel — pick nothing"
                          onClick={() => setLinkingFrom(null)}
                          className="shrink-0 px-2 py-3 text-primary font-bold"
                        >
                          ×
                        </button>
                      ) : (
                        <button
                          data-testid={`gantt-link-end-${issue.id}`}
                          aria-label={`Finish the dependency at ${issue.title}`}
                          title={`Depend ${issue.title} on the issue you started from`}
                          onClick={() => { createLink(linkingFrom, issue.id); setLinkingFrom(null); }}
                          className="shrink-0 px-2 py-3 text-primary hover:brightness-125 font-bold"
                        >
                          ＋
                        </button>
                      )}
                    </div>
                    <div className="flex-1 px-4 py-3 relative h-12">
                      <button
                        data-testid={`gantt-bar-${issue.id}`}
                        aria-label={canReschedule ? `Reschedule ${issue.title}` : issue.title}
                        onClick={() => { if (!canReschedule) setEditing(issue); }}
                        onPointerDown={(e) => {
                          if (!canReschedule) return;
                          const track = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                          gesture.current = { id: issue.id, startX: e.clientX, pxPerDay: track.width / span || 1, moved: false };
                          e.currentTarget.setPointerCapture?.(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          const g = gesture.current;
                          if (!g || g.id !== issue.id) return;
                          if (Math.abs(e.clientX - g.startX) > 3) g.moved = true;
                          setDrag({ id: issue.id, deltaDays: Math.round((e.clientX - g.startX) / g.pxPerDay) });
                        }}
                        onPointerUp={(e) => {
                          const g = gesture.current;
                          gesture.current = null;
                          e.currentTarget.releasePointerCapture?.(e.pointerId);
                          const deltaDays = drag?.id === issue.id ? drag.deltaDays : 0;
                          setDrag(null);
                          if (!g) return;
                          if (!g.moved) { setEditing(issue); return; } // a click, not a drag
                          if (cascade) {
                            const currentStartById: Record<string, number> = {};
                            for (const l of lanes) currentStartById[l.issue.id] = l.startDay;
                            const shifts = computeCascade(calendar, issues ?? [], [...loadEdges(), ...(brokeredEdges ?? [])], projectId, currentStartById, issue.id, deltaDays, hoursPerDay);
                            void commitCascade(shifts);
                          } else {
                            commitReschedule(issue, deltaDays);
                          }
                        }}
                        className={`absolute top-1/2 -translate-y-1/2 h-5 ${STATUS_COLORS[issue.status]} ${
                          overdue ? "ring-2 ring-red-500" : ""
                        } ${canReschedule ? "cursor-grab active:cursor-grabbing touch-none" : ""} ${moving ? "opacity-60" : ""} hover:brightness-110`}
                        style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                        title={`${STATUS_LABELS[issue.status]} · ${fmt(startDay + nudged)} → ${fmt(endDay + nudged)}${overdue ? " · OVERDUE" : ""}${canReschedule ? " · drag to reschedule" : ""}`}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <IssueDialog
        projectId={projectId}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        issue={editing}
      />
    </>
  );
}
