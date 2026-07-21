import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useUpdateTask, type Task } from "../lib/tasks";

/**
 * TaskRecurrence — the authoring front door for a task's repeat rule. The recurrence ENGINE lives server-side
 * (it spawns the next occurrence when a recurring task is completed); this just sets the free-text `recurrence`
 * string on the task. Common cadences are one-click presets; anything else (e.g. "every 2 weeks", "FREQ=MONTHLY")
 * goes in the free-text field. Clearing it makes the task one-off again.
 */

/** Common cadences the engine understands (see api-server lib/recurrence). */
const PRESETS: Array<{ label: string; rule: string }> = [
  { label: "Daily", rule: "every day" },
  { label: "Weekdays", rule: "every weekday" },
  { label: "Weekly", rule: "every week" },
  { label: "Monthly", rule: "every month" },
  { label: "Yearly", rule: "every year" },
];

export function TaskRecurrence({ task }: { task: Task }) {
  const update = useUpdateTask();
  const current = task.recurrence ?? "";
  const [text, setText] = useState(current);

  const set = (rule: string): void => { update.mutate({ id: task.id, patch: { recurrence: rule || null } }); };

  return (
    <div data-testid="task-recurrence">
      <h3 className="text-xs font-bold uppercase tracking-widest mb-2">Repeat</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={!current}
          className={`px-2 py-1 text-[11px] uppercase tracking-wide rounded-none border ${!current ? "border-foreground font-bold" : "border-border text-muted-foreground"}`}
          onClick={() => { setText(""); set(""); }}
        >Never</button>
        {PRESETS.map((p) => {
          const active = current.trim().toLowerCase() === p.rule;
          return (
            <button
              key={p.rule}
              type="button"
              aria-pressed={active}
              className={`px-2 py-1 text-[11px] uppercase tracking-wide rounded-none border ${active ? "border-foreground font-bold" : "border-border text-muted-foreground"}`}
              onClick={() => { setText(p.rule); set(p.rule); }}
            >{p.label}</button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="flex-1 rounded-none border border-border bg-card px-3 py-2 text-sm"
          aria-label="Recurrence rule"
          placeholder="Custom — e.g. every 2 weeks, every monday, FREQ=MONTHLY"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") set(text.trim()); }}
        />
        <Button className="rounded-none" variant="outline" onClick={() => set(text.trim())} disabled={text.trim() === current.trim() || update.isPending}>Set</Button>
      </div>
      {current && <p className="mt-1 text-[11px] text-muted-foreground">Repeats <span className="font-mono">{current}</span> — completing it spawns the next occurrence.</p>}
    </div>
  );
}
