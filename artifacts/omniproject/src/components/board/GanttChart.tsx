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
import { canStoreField } from "../../lib/capabilities-fields";
import { rescheduledDates } from "../../lib/reschedule";
import { DAY_MS, dayToShortDate } from "../../lib/date-utils";
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
  const [editing, setEditing] = useState<Issue | null>(null);
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

    const min = Math.min(...lanes.map((l) => l.startDay));
    const max = Math.max(...lanes.map((l) => l.endDay));
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

  return (
    <>
      <div className="h-full overflow-auto bg-card border border-border">
        <div className="min-w-[720px]">
          {/* Header / axis */}
          <div className="flex items-center border-b border-border bg-background sticky top-0 z-10">
            <div className="w-64 shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground border-r border-border">
              Issue
            </div>
            <div className="flex-1 px-4 py-2 flex justify-between text-xs font-mono text-muted-foreground">
              <span>{fmt(min)}</span>
              <span>{fmt(min + span - 1)}</span>
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
            {lanes.map(({ issue, startDay, endDay }) => {
                const nudged = drag?.id === issue.id ? drag.deltaDays : 0;
                const offsetPct = ((startDay - min + nudged) / span) * 100;
                const widthPct = Math.max(((endDay - startDay + 1) / span) * 100, 2);
                const overdue =
                  endDay < today && issue.status !== "done" && issue.status !== "cancelled";
                const moving = updateIssue.isPending;
                return (
                  <div key={issue.id} className="flex items-center border-b border-border hover:bg-muted/20 group">
                    <button
                      onClick={() => setEditing(issue)}
                      className="w-64 shrink-0 px-4 py-3 text-left border-r border-border truncate text-sm font-semibold group-hover:text-primary"
                      title={issue.title}
                    >
                      {issue.title}
                    </button>
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
                          commitReschedule(issue, deltaDays);
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
