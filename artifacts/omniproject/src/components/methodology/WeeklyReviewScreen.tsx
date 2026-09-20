import { useMemo, useState } from "react";
import { useListProjects } from "@workspace/api-client-react";
import { evaluateMethodologyInvariants, getMethodology } from "@workspace/backend-catalogue";
import { useTasks, useUpdateTask, type Task } from "../../lib/tasks";
import { DataState } from "../DataState";

/**
 * Weekly Review — GTD's reflect stage as a guided flow, the pack's `weekly-review` ceremony made
 * walkable. Five steps over the live task entity: drive the Inbox to zero, sweep Next actions for
 * staleness, chase Waiting-for items, reconsider Someday/Maybe, and finish on the pack's own
 * invariant — every active project needs a defined next action (`evaluateMethodologyInvariants`,
 * the same engine the methodology deploy preview reports). Each step offers the small set of GTD
 * re-files (→ next / waiting / scheduled / someday / done / dropped) inline, so the review IS the
 * clean-up, not a checklist about doing one later.
 */

const STEPS = [
  { id: "inbox", title: "Inbox to zero", blurb: "Clarify every captured item: what is it, is it actionable, what's the next physical action?" },
  { id: "next", title: "Next actions", blurb: "Still the right next actions? Re-file anything stale, done, or no longer yours." },
  { id: "waiting", title: "Waiting for", blurb: "Chase or release each delegated item. Has it arrived? Promote it to a next action." },
  { id: "someday", title: "Someday / Maybe", blurb: "Anything here whose time has come? Activate it — or let it go." },
  { id: "projects", title: "Projects", blurb: "GTD's core promise: every active project has a defined next action." },
] as const;
type StepId = (typeof STEPS)[number]["id"];

/** The GTD re-file targets offered on a task row, per step (never the row's current status). */
const REFILE: Record<Exclude<StepId, "projects">, { to: string; label: string }[]> = {
  inbox: [
    { to: "next", label: "→ Next" },
    { to: "waiting", label: "→ Waiting" },
    { to: "scheduled", label: "→ Scheduled" },
    { to: "someday", label: "→ Someday" },
    { to: "done", label: "Done" },
    { to: "dropped", label: "Drop" },
  ],
  next: [
    { to: "someday", label: "→ Someday" },
    { to: "waiting", label: "→ Waiting" },
    { to: "done", label: "Done" },
    { to: "dropped", label: "Drop" },
  ],
  waiting: [
    { to: "next", label: "→ Next (arrived)" },
    { to: "done", label: "Done" },
    { to: "dropped", label: "Drop" },
  ],
  someday: [
    { to: "next", label: "→ Next (activate)" },
    { to: "dropped", label: "Drop" },
  ],
};

function TaskRow({ task, actions, onRefile }: { task: Task; actions: { to: string; label: string }[]; onRefile: (id: string, to: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border border-border bg-background p-2" data-testid="review-task-row">
      <div className="flex-1 min-w-40">
        <div className="text-sm font-medium">{task.title}</div>
        <div className="text-[10px] text-muted-foreground font-mono">
          {task.context ? `@${task.context} ` : ""}
          {task.dueDate ? `due ${task.dueDate} ` : ""}
          {task.waitingOn ? `waiting on ${task.waitingOn}` : ""}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {actions.map((a) => (
          <button
            key={a.to}
            type="button"
            onClick={() => onRefile(task.id, a.to)}
            className="border border-border px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide hover:bg-accent"
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WeeklyReviewScreen() {
  const { data: tasks, isLoading, isError, error, refetch } = useTasks();
  const projectsQ = useListProjects();
  const update = useUpdateTask();
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState<Set<StepId>>(new Set(["inbox"]));

  const byStep = useMemo(() => {
    const all = tasks ?? [];
    const of = (status: string) => all.filter((t) => t.status === status);
    return { inbox: of("inbox"), next: of("next"), waiting: of("waiting"), someday: of("someday") };
  }, [tasks]);

  const violations = useMemo(() => {
    const gtd = getMethodology("gtd");
    if (!gtd) return [];
    const all = tasks ?? [];
    // Only projects that actually carry tasks are GTD-managed here — an issue-driven project with no
    // task entities would otherwise always be flagged, which turns the step into noise, not signal.
    const managed = new Set(all.map((t) => t.projectId).filter(Boolean));
    const projects = (projectsQ.data ?? []).filter((p) => managed.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
    return evaluateMethodologyInvariants(gtd, { projects, tasks: all });
  }, [tasks, projectsQ.data]);

  const goTo = (i: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, i));
    setStep(clamped);
    setVisited((v) => new Set(v).add(STEPS[clamped]!.id));
  };
  const refile = (id: string, to: string) => update.mutate({ id, patch: { status: to } });

  const current = STEPS[step]!;
  const countOf = (id: StepId): number => (id === "projects" ? violations.length : byStep[id].length);
  const complete = visited.size === STEPS.length && STEPS.every((s) => countOf(s.id) === 0 || s.id === "someday" || s.id === "next");

  return (
    <div className="p-6 space-y-4" data-testid="weekly-review-screen">
      <div>
        <h1 className="text-xl font-black uppercase tracking-widest">Weekly Review</h1>
        <p className="text-xs text-muted-foreground">Capture is only trustworthy if you reflect. Walk the five steps; re-file inline.</p>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Review steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === step}
            onClick={() => goTo(i)}
            className={`border px-2 py-1 text-[11px] font-mono uppercase tracking-wide ${i === step ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}
          >
            {i + 1}. {s.title} ({countOf(s.id)})
          </button>
        ))}
      </div>

      <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()}>
        <div className="space-y-2">
          <div className="border border-border bg-background p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Step {step + 1} of {STEPS.length}</div>
            <div className="text-sm">{current.blurb}</div>
          </div>

          {current.id !== "projects" ? (
            byStep[current.id].length === 0 ? (
              <div className="border border-border p-4 text-sm text-muted-foreground" data-testid="step-clear">
                Nothing here — this list is clear. ✓
              </div>
            ) : (
              byStep[current.id].map((t) => <TaskRow key={t.id} task={t} actions={REFILE[current.id]} onRefile={refile} />)
            )
          ) : violations.length === 0 ? (
            <div className="border border-border p-4 text-sm text-muted-foreground" data-testid="step-clear">
              Every active project with tasks has a next action. ✓
            </div>
          ) : (
            violations.map((v) => (
              <div key={v.subjectId} className="border border-border bg-background p-2" data-testid="violation-row">
                <div className="text-sm font-medium">{v.subjectLabel ?? v.subjectId}</div>
                <div className="text-[11px] text-muted-foreground">{v.message}</div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <button type="button" onClick={() => goTo(step - 1)} disabled={step === 0} className="border border-border px-3 py-1 text-xs font-mono uppercase disabled:opacity-40">
            ← Back
          </button>
          {complete && <div className="text-xs font-mono uppercase tracking-widest" data-testid="review-complete">Review complete — mind like water.</div>}
          <button type="button" onClick={() => goTo(step + 1)} disabled={step === STEPS.length - 1} className="border border-border px-3 py-1 text-xs font-mono uppercase disabled:opacity-40">
            Next →
          </button>
        </div>
      </DataState>
    </div>
  );
}
