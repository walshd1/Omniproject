import { useMemo, useState } from "react";
import { useGetProjectIssues, type Issue } from "@workspace/api-client-react";
import { STATUS_COLORS, STATUS_LABELS } from "../../lib/constants";
import { IssueDialog } from "../IssueDialog";

const DAY_MS = 1000 * 60 * 60 * 24;

function startOfDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

interface Lane {
  issue: Issue;
  startDay: number;
  endDay: number;
}

export function GanttChart({ projectId }: { projectId: string }) {
  const { data: issues, isLoading } = useGetProjectIssues(projectId);
  const [editing, setEditing] = useState<Issue | null>(null);

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

    const min = Math.min(...lanes.map((l) => l.startDay));
    const max = Math.max(...lanes.map((l) => l.endDay));
    const span = Math.max(max - min + 1, 1);
    const today = startOfDay(new Date());

    return { lanes, min, max, span, today };
  }, [issues]);

  if (isLoading) {
    return <div className="p-8 text-center font-bold tracking-widest text-muted-foreground animate-pulse">LOADING…</div>;
  }

  if (!model) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-card border border-border text-muted-foreground font-bold p-6 text-center uppercase tracking-wider">
        No scheduled issues. Add start / due dates to see the timeline.
      </div>
    );
  }

  const { lanes, min, span, today } = model;
  const fmt = (day: number) => new Date(day * DAY_MS).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
            {lanes
              .sort((a, b) => a.startDay - b.startDay)
              .map(({ issue, startDay, endDay }) => {
                const offsetPct = ((startDay - min) / span) * 100;
                const widthPct = Math.max(((endDay - startDay + 1) / span) * 100, 2);
                const overdue =
                  endDay < today && issue.status !== "done" && issue.status !== "cancelled";
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
                        onClick={() => setEditing(issue)}
                        className={`absolute top-1/2 -translate-y-1/2 h-5 ${STATUS_COLORS[issue.status]} ${
                          overdue ? "ring-2 ring-red-500" : ""
                        } hover:brightness-110`}
                        style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                        title={`${STATUS_LABELS[issue.status]} · ${fmt(startDay)} → ${fmt(endDay)}${overdue ? " · OVERDUE" : ""}`}
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
