import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getJson, sendJson } from "../../lib/api";
import { schedulingOrgKey, schedulingResolvedKey, type RawSchedulingConfig } from "../../lib/scheduling-settings";

/**
 * Admin control for the org's WORKING-TIME policy (roadmap 3.1 follow-up 7b) — hours per working day plus the
 * working week and holidays that the (client-side, projected) scheduling engine uses. The policy is a
 * scope-layered `scheduling` config def, not a settings key: this reads the org-scope values from
 * `GET /api/scheduling` and writes them with `PUT /api/scheduling`. The engine reads the RESOLVED policy through
 * `useSchedulingSettings`, so saving here re-plans every forecast / Gantt cascade / critical path. Admin/PMO.
 */

// Display order Mon→Sun; value is Date.getUTCDay (0 = Sun).
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" }, { value: 2, label: "Tue" }, { value: 3, label: "Wed" },
  { value: 4, label: "Thu" }, { value: 5, label: "Fri" }, { value: 6, label: "Sat" }, { value: 0, label: "Sun" },
];

export function SchedulingSettingsAdmin() {
  const { data: orgConfig } = useQuery({
    queryKey: schedulingOrgKey,
    queryFn: () => getJson<{ scheduling: RawSchedulingConfig }>("/api/scheduling"),
    staleTime: 15_000,
  });
  const raw = orgConfig?.scheduling;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [hoursPerDay, setHoursPerDay] = useState("8");
  const [workingDays, setWorkingDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [holidays, setHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed the editor from settings once they arrive (and whenever they change under us).
  useEffect(() => {
    if (!raw) return;
    if (typeof raw.hoursPerDay === "number") setHoursPerDay(String(raw.hoursPerDay));
    if (Array.isArray(raw.workingWeekdays)) setWorkingDays(new Set(raw.workingWeekdays));
    if (Array.isArray(raw.holidays)) setHolidays([...raw.holidays]);
  }, [raw]);

  const toggleDay = (value: number) =>
    setWorkingDays((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });

  const addHoliday = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newHoliday) || holidays.includes(newHoliday)) return;
    setHolidays((prev) => [...prev, newHoliday].sort());
    setNewHoliday("");
  };

  const hours = Number(hoursPerDay);
  const valid = Number.isFinite(hours) && hours > 0 && hours <= 24 && workingDays.size > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    const scheduling: RawSchedulingConfig = {
      hoursPerDay: hours,
      workingWeekdays: [...workingDays].sort((a, b) => a - b),
      holidays,
    };
    try {
      await sendJson("/api/scheduling", { scheduling }, "PUT");
      // The admin editor seeds from the org config; the engine reads the resolved policy — refresh both.
      queryClient.invalidateQueries({ queryKey: schedulingOrgKey });
      queryClient.invalidateQueries({ queryKey: schedulingResolvedKey });
      toast({ title: "WORKING TIME SAVED", description: `${hours}h/day · ${workingDays.size}-day week · ${holidays.length} holiday${holidays.length === 1 ? "" : "s"}` });
    } catch {
      toast({ title: "COULD NOT SAVE", description: "Check the values and try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-testid="scheduling-settings">
      <div className="flex items-center gap-3 mb-4">
        <CalendarClock className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">Working time (scheduling)</h2>
      </div>

      <div className="bg-card border border-border p-4 space-y-5">
        <p className="text-xs text-muted-foreground">
          How the scheduling engine counts time — used to turn estimates into durations and to skip non-working
          days when it auto-schedules, forecasts, and cascades dependents. A <strong>projection only</strong>;
          nothing here is written to your backend.
        </p>

        <div className="flex items-center gap-3">
          <label htmlFor="sched-hours" className="text-xs font-bold uppercase tracking-widest text-muted-foreground w-40">Hours per working day</label>
          <input
            id="sched-hours"
            data-testid="sched-hours"
            type="number"
            min={1}
            max={24}
            step={0.5}
            value={hoursPerDay}
            onChange={(e) => setHoursPerDay(e.target.value)}
            className="w-24 border border-border bg-background px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Working week</div>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => {
              const on = workingDays.has(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  data-testid={`sched-day-${d.value}`}
                  aria-pressed={on}
                  onClick={() => toggleDay(d.value)}
                  className={`px-3 py-1.5 text-xs font-bold uppercase tracking-widest border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted/40"} focus:outline-none focus:ring-2 focus:ring-ring`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          {workingDays.size === 0 && <p className="text-[11px] text-red-600 mt-1">Pick at least one working day.</p>}
        </div>

        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Holidays (non-working)</div>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="date"
              data-testid="sched-holiday-input"
              value={newHoliday}
              onChange={(e) => setNewHoliday(e.target.value)}
              className="border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={addHoliday}
              data-testid="sched-holiday-add"
              className="border border-border px-3 py-1.5 text-xs font-black uppercase tracking-widest hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Add
            </button>
          </div>
          {holidays.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" data-testid="sched-holiday-list">
              {holidays.map((h) => (
                <li key={h} className="inline-flex items-center gap-1.5 border border-border px-2 py-1 text-xs tabular-nums">
                  {h}
                  <button type="button" aria-label={`Remove ${h}`} onClick={() => setHolidays((prev) => prev.filter((x) => x !== h))} className="text-muted-foreground hover:text-red-600">×</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted-foreground">No holidays configured.</p>
          )}
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || saving}
            data-testid="sched-save"
            className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {saving ? "SAVING…" : "Save working time"}
          </button>
        </div>
      </div>
    </section>
  );
}
