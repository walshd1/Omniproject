import { useMemo, useState } from "react";
import { useGetProjectIssues, type Issue } from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { STATUS_LABELS } from "../../lib/constants";
import { inActiveSprint, storyPoints, isDone, SPRINT_COLUMNS } from "../../lib/methodology";
import { IssueDialog } from "../IssueDialog";
import { LoadingState } from "../LoadingState";
import { PriorityDot } from "../StatusDot";

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="border border-border bg-background p-3">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">{label}</div>
      <div className={`text-xl font-black font-mono ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function Burndown({ committed, remaining }: { committed: number; remaining: number }) {
  // Snapshot data → indicative burndown: ideal linear committed→0 vs an actual
  // line easing committed→remaining.
  const days = 10;
  const data = Array.from({ length: days + 1 }, (_, d) => {
    const ideal = Math.round(committed * (1 - d / days));
    const t = d / days;
    // Quadratic ease-out (t*(2-t)): the actual line bows toward `remaining` for a
    // realistic burndown shape rather than a straight line.
    const actual = Math.round(committed - (committed - remaining) * (t * (2 - t)));
    return { day: `D${d}`, Ideal: ideal, Remaining: actual };
  });
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
          <XAxis dataKey="day" stroke="currentColor" className="text-muted-foreground" fontSize={11} />
          <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} />
          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
          <Legend />
          <Line type="monotone" dataKey="Ideal" stroke="#a1a1aa" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="Remaining" stroke="#22c55e" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScrumView({ projectId }: { projectId: string }) {
  const { data: issues, isLoading } = useGetProjectIssues(projectId);
  const [editing, setEditing] = useState<Issue | null>(null);

  const model = useMemo(() => {
    const all = issues ?? [];
    const sprint = all.filter(inActiveSprint);
    const backlog = all.filter((i) => !inActiveSprint(i) && i.status !== "cancelled");
    const committed = sprint.reduce((sum, i) => sum + storyPoints(i), 0);
    const completed = sprint.filter((i) => isDone(i.status)).reduce((sum, i) => sum + storyPoints(i), 0);
    return { sprint, backlog, committed, completed, remaining: committed - completed };
  }, [issues]);

  if (isLoading) return <LoadingState />;

  return (
    <>
      <div className="h-full flex flex-col gap-6">
        {/* Sprint metrics + burndown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Committed (pts)" value={model.committed} />
            <Stat label="Completed (pts)" value={model.completed} accent="text-green-500" />
            <Stat label="Remaining" value={model.remaining} accent={model.remaining > 0 ? "text-amber-500" : "text-green-500"} />
            <Stat label="Velocity" value={model.completed} />
          </div>
          <div className="bg-card border border-border p-4">
            <div className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-2">Sprint Burndown (indicative)</div>
            <Burndown committed={model.committed} remaining={model.remaining} />
          </div>
        </div>

        {/* Sprint board + backlog */}
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_18rem] gap-6 min-h-0">
          <div className="flex gap-4 overflow-x-auto pb-2">
            {SPRINT_COLUMNS.map((status) => {
              const col = model.sprint.filter((i) => i.status === status);
              const pts = col.reduce((s, i) => s + storyPoints(i), 0);
              return (
                <div key={status} className="w-72 shrink-0 flex flex-col bg-card border border-border">
                  <div className="p-3 border-b border-border bg-background flex items-center justify-between">
                    <span className="font-bold text-sm tracking-wider">{STATUS_LABELS[status]}</span>
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 font-mono">{col.length} · {pts}p</span>
                  </div>
                  <div className="flex-1 p-3 flex flex-col gap-2 overflow-y-auto min-h-24">
                    {col.map((issue) => (
                      <button
                        key={issue.id}
                        onClick={() => setEditing(issue)}
                        className="text-left bg-background border border-border p-3 hover:border-primary"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <PriorityDot priority={issue.priority} />
                          <span className="text-[10px] font-mono text-muted-foreground">{storyPoints(issue)}p</span>
                        </div>
                        <div className="text-sm font-semibold">{issue.title}</div>
                      </button>
                    ))}
                    {col.length === 0 && <div className="text-[11px] text-muted-foreground/60 text-center py-4 uppercase tracking-widest">Empty</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="bg-card border border-border flex flex-col min-h-0">
            <div className="p-3 border-b border-border bg-background font-bold text-sm tracking-wider flex items-center justify-between">
              <span>PRODUCT BACKLOG</span>
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 font-mono">{model.backlog.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {model.backlog.map((issue) => (
                <button key={issue.id} onClick={() => setEditing(issue)} className="text-left bg-background border border-border p-2 hover:border-primary flex items-center gap-2">
                  <PriorityDot priority={issue.priority} className="shrink-0" />
                  <span className="text-sm truncate flex-1">{issue.title}</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">{storyPoints(issue)}p</span>
                </button>
              ))}
              {model.backlog.length === 0 && <div className="text-[11px] text-muted-foreground/60 text-center py-4 uppercase tracking-widest">Empty</div>}
            </div>
          </aside>
        </div>
      </div>

      <IssueDialog projectId={projectId} open={!!editing} onOpenChange={(o) => !o && setEditing(null)} issue={editing} />
    </>
  );
}
