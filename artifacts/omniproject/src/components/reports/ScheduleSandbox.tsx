import { useMemo, useState } from "react";
import { useListProjects, useGetProjectIssues, useGetCapabilities } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  buildScheduleItems,
  computeSchedule,
  type ScheduleInput,
} from "../../lib/schedule-scenario";
import { triggerBlobDownload } from "../../lib/setup";
import { useScheduleShifts } from "./use-schedule-shifts";
import { useResourceContention } from "./use-resource-contention";

const DAY_MS = 1000 * 60 * 60 * 24;
const fmtDay = (day: number) =>
  new Date(day * DAY_MS).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/**
 * Schedule what-if sandbox — drag a work package into the future and watch the
 * knock-ons cascade down its dependencies. Entirely client-side and volatile
 * (it lives in /explore): nothing is written back, every figure is `projected`.
 */
export function ScheduleSandbox() {
  const { data: projects } = useListProjects();
  const { data: caps } = useGetCapabilities();
  const [projectId, setProjectId] = useState("");
  const activeProject = projectId || projects?.[0]?.id || "";
  const { data: issues } = useGetProjectIssues(activeProject);

  const items = useMemo(
    () => buildScheduleItems((issues ?? []) as ScheduleInput[]),
    [issues],
  );

  // Volatile scenario state — shifts/edges plus the drag gesture. `getSpan` is a
  // getter so the drag reads the latest span (itself derived from these shifts).
  const {
    shifts,
    edges,
    setEdges,
    pred,
    setPred,
    succ,
    setSucc,
    touch,
    reset,
    addEdge,
    importLinked,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    nudge,
  } = useScheduleShifts({ items, getSpan: () => span });

  const result = useMemo(() => computeSchedule(items, edges, shifts), [items, edges, shifts]);

  const span = Math.max(result.rangeEndDay - result.rangeStartDay + 1, 1);
  const pct = (day: number) => ((day - result.rangeStartDay) / span) * 100;

  const { contention, showCapacity } = useResourceContention({
    issues,
    result,
    caps,
    itemsLength: items.length,
  });

  const exportScenario = () => {
    const payload = {
      schema: 1,
      kind: "schedule-scenario",
      projectId: activeProject,
      capturedAt: new Date().toISOString(),
      shifts,
      edges,
      summary: result.summary,
      items: result.items.map((i) => ({
        id: i.id,
        title: i.title,
        baseStart: fmtDay(i.baseStartDay),
        baseEnd: fmtDay(i.baseEndDay),
        resolvedStart: fmtDay(i.resolvedStartDay),
        resolvedEnd: fmtDay(i.resolvedEndDay),
        totalShiftDays: i.totalShiftDays,
      })),
    };
    triggerBlobDownload(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      `omniproject-schedule-scenario-${new Date().toISOString().slice(0, 10)}.json`,
    );
  };

  const dirty = Object.values(shifts).some((v) => v !== 0) || edges.length > 0;

  return (
    <section data-testid="schedule-sandbox" className="border border-blue-500/30 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 className="text-sm font-black uppercase tracking-widest">
            Schedule What-If
            <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-widest text-blue-500 border border-blue-500/40 px-1.5 py-0.5">
              projected
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Drag a bar to start a package later (or use ← →). Dependents cascade — the knock-ons.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {projects && projects.length > 0 && (
            <Select value={activeProject} onValueChange={(v) => { setProjectId(v); reset(); }}>
              <SelectTrigger aria-label="Scenario project" className="w-auto rounded-none border-border text-xs font-bold uppercase gap-2 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-none border-border font-bold uppercase">
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" variant="outline" onClick={reset} disabled={!dirty}
            className="rounded-none border-border uppercase font-bold tracking-wider text-xs h-9">Reset</Button>
          <Button type="button" onClick={exportScenario} disabled={!dirty}
            className="rounded-none uppercase font-bold tracking-wider text-xs h-9">Export</Button>
        </div>
      </div>

      {/* Knock-on summary */}
      <div data-testid="schedule-summary" className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border">
        {[
          { label: "Moved", value: result.summary.directlyMovedCount },
          { label: "Knock-ons", value: result.summary.knockOnCount, accent: result.summary.knockOnCount > 0 },
          { label: "Project end", value: `${result.summary.projectEndDeltaDays >= 0 ? "+" : ""}${result.summary.projectEndDeltaDays}d`, accent: result.summary.projectEndDeltaDays > 0 },
          { label: "New breaches", value: result.summary.newBreachCount, danger: result.summary.newBreachCount > 0 },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-card p-3 text-center">
            <div aria-label={kpi.label} className={`text-2xl font-black tabular-nums ${kpi.danger ? "text-red-500" : kpi.accent ? "text-amber-500" : ""}`}>{kpi.value}</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{kpi.label}</div>
          </div>
        ))}
      </div>
      {result.summary.hasCycle && (
        <p role="alert" className="px-4 py-2 text-xs font-bold text-amber-500 border-b border-border">
          A dependency cycle was detected — the cyclic links were ignored in this projection.
        </p>
      )}

      {/* Gantt */}
      {items.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          No scheduled issues in this project. Add start / due dates to model the timeline.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            {result.items
              .slice()
              .sort((a, b) => a.resolvedStartDay - b.resolvedStartDay)
              .map((it) => {
                const tone = it.newlyBreached
                  ? "bg-red-500"
                  : it.movedByUser
                    ? "bg-amber-500"
                    : it.movedByCascade
                      ? "bg-rose-400"
                      : "bg-primary/60";
                return (
                  <div key={it.id} className="flex items-center border-b border-border hover:bg-muted/20">
                    <div className="w-48 shrink-0 truncate px-3 py-2 text-sm font-semibold border-r border-border" title={it.title}>
                      {it.title}
                    </div>
                    <div className="relative flex-1 h-11 px-2">
                      {/* faint base position (where it was) */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-4 border border-dashed border-muted-foreground/40"
                        style={{ left: `${pct(it.baseStartDay)}%`, width: `${Math.max((it.baseEndDay - it.baseStartDay + 1) / span * 100, 1.5)}%` }}
                        aria-hidden
                      />
                      {/* draggable resolved bar */}
                      <button
                        type="button"
                        onPointerDown={(e) => onPointerDown(e, it.id)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowRight") { e.preventDefault(); nudge(it.id, 1); }
                          if (e.key === "ArrowLeft") { e.preventDefault(); nudge(it.id, -1); }
                        }}
                        aria-label={`${it.title}: ${fmtDay(it.resolvedStartDay)} to ${fmtDay(it.resolvedEndDay)}${it.totalShiftDays ? `, shifted ${it.totalShiftDays} days` : ""}. Arrow keys to move.`}
                        className={`absolute top-1/2 -translate-y-1/2 h-5 ${tone} cursor-ew-resize touch-none ring-offset-1 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-ring`}
                        style={{ left: `${pct(it.resolvedStartDay)}%`, width: `${Math.max((it.resolvedEndDay - it.resolvedStartDay + 1) / span * 100, 1.5)}%` }}
                        title={`${fmtDay(it.resolvedStartDay)} → ${fmtDay(it.resolvedEndDay)}${it.totalShiftDays ? ` · ${it.totalShiftDays > 0 ? "+" : ""}${it.totalShiftDays}d` : ""}${it.movedByCascade && !it.movedByUser ? " · knock-on" : ""}`}
                      />
                      {it.totalShiftDays !== 0 && (
                        <span
                          className="absolute top-1/2 -translate-y-1/2 text-[10px] font-bold tabular-nums text-muted-foreground pointer-events-none"
                          style={{ left: `calc(${pct(it.resolvedStartDay)}% + ${Math.max((it.resolvedEndDay - it.resolvedStartDay + 1) / span * 100, 1.5)}%)`, marginLeft: 4 }}
                        >
                          {it.totalShiftDays > 0 ? "+" : ""}{it.totalShiftDays}d
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Resource capacity what-if */}
      {showCapacity && (
        <div data-testid="resource-capacity" className="border-t border-border p-4 space-y-3">
          <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Resource load</h3>
          {contention.length === 0 ? (
            <p className="text-xs text-green-600 dark:text-green-400 font-semibold">
              No resource clashes — nobody is double-booked in this scenario.
            </p>
          ) : (
            <ul className="space-y-2">
              {contention.map((p) => (
                <li key={p.assignee} className="border border-border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">{p.assignee}</span>
                    <span className="flex items-center gap-2">
                      {p.newlyContended && (
                        <span className="text-[10px] font-black uppercase tracking-widest text-red-500 border border-red-500/40 px-1.5 py-0.5">
                          new clash
                        </span>
                      )}
                      <span className={`font-mono font-bold tabular-nums ${p.newlyContended ? "text-red-500" : "text-amber-500"}`}>
                        {p.peakConcurrency} concurrent
                      </span>
                    </span>
                  </div>
                  {p.peak && (
                    <p className="mt-1 text-muted-foreground">
                      Overlapping: {p.peak.tasks.map((tk) => tk.title).join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Capacity is modelled by overlap — moving a package onto someone's other live work flags a clash. Projected only.
          </p>
        </div>
      )}

      {/* Dependency editor */}
      <div className="border-t border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Dependencies</h3>
          <Button type="button" variant="outline" onClick={importLinked}
            className="rounded-none border-border uppercase font-bold tracking-wider text-[11px] h-8">
            Import linked
          </Button>
        </div>
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Select value={succ} onValueChange={setSucc}>
              <SelectTrigger aria-label="Dependent issue" className="w-44 rounded-none border-border text-xs h-9"><SelectValue placeholder="This issue…" /></SelectTrigger>
              <SelectContent className="rounded-none border-border">
                {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="font-bold uppercase text-muted-foreground">depends on</span>
            <Select value={pred} onValueChange={setPred}>
              <SelectTrigger aria-label="Predecessor issue" className="w-44 rounded-none border-border text-xs h-9"><SelectValue placeholder="…finishing" /></SelectTrigger>
              <SelectContent className="rounded-none border-border">
                {items.map((i) => <SelectItem key={i.id} value={i.id}>{i.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" onClick={addEdge} disabled={!pred || !succ || pred === succ}
              className="rounded-none uppercase font-bold tracking-wider text-[11px] h-9">Add</Button>
          </div>
        )}
        {edges.length > 0 && (
          <ul className="space-y-1">
            {edges.map((e, i) => {
              const name = (id: string) => items.find((x) => x.id === id)?.title ?? id;
              return (
                <li key={`${e.predecessorId}>${e.successorId}`} className="flex items-center justify-between text-xs border border-border px-2 py-1">
                  <span><b>{name(e.successorId)}</b> depends on <b>{name(e.predecessorId)}</b></span>
                  <button type="button" aria-label="Remove dependency" onClick={() => { setEdges((es) => es.filter((_, j) => j !== i)); touch(); }}
                    className="text-muted-foreground hover:text-red-500 font-bold px-1">✕</button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          Stateless projection — dependencies and shifts live in this session only. Export to keep the scenario.
        </p>
      </div>
    </section>
  );
}
