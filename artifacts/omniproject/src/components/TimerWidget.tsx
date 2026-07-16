import { useEffect, useState } from "react";
import { Play, Square, Timer as TimerIcon } from "lucide-react";
import { useFeatures, featureEnabled } from "../lib/features";
import { useTimer, useStartTimer, useStopTimer, formatElapsed } from "../lib/live-timer";
import { useToast } from "@/hooks/use-toast";

/**
 * Live timer widget (roadmap 3.3). Shows the caller's running clock (ticking locally between server polls),
 * or a compact start form when idle. Stopping surfaces the day-grained timesheet entry it produced. Renders
 * nothing unless the `timeTracking` feature module is enabled. Compact enough to sit on a page header.
 */
export function TimerWidget({ defaultProjectId = "" }: { defaultProjectId?: string }) {
  const { data: features } = useFeatures();
  const { data: state } = useTimer();
  const start = useStartTimer();
  const stop = useStopTimer();
  const { toast } = useToast();
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [note, setNote] = useState("");
  const [tick, setTick] = useState(0);

  // Tick once a second so the elapsed display advances between the server's minute polls.
  useEffect(() => {
    if (!state?.running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state?.running]);

  if (!featureEnabled(features, "timeTracking")) return null;

  const liveElapsed = (() => {
    if (!state?.running || !state.timer) return 0;
    const ms = Date.now() - Date.parse(state.timer.startedAt);
    return Math.max(0, ms / 3_600_000);
  })();

  const onStop = () => {
    stop.mutate(undefined, {
      onSuccess: (r) => toast({ title: "TIMER STOPPED", description: `Logged ${r.entry.hours}h on ${r.entry.projectId}` }),
    });
  };

  return (
    <div className="inline-flex items-center gap-2 border border-border bg-card px-2 py-1.5" data-testid="timer-widget">
      <TimerIcon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
      {state?.running ? (
        <>
          <span className="font-mono tabular-nums text-sm" data-testid="timer-elapsed" data-tick={tick}>{formatElapsed(liveElapsed)}</span>
          <span className="text-xs text-muted-foreground truncate max-w-[8rem]" title={state.timer?.projectId}>{state.timer?.projectId}</span>
          <button type="button" onClick={onStop} disabled={stop.isPending} data-testid="timer-stop" aria-label="Stop timer" className="inline-flex items-center gap-1 border border-red-500/50 text-red-600 px-2 py-1 text-xs font-black uppercase tracking-widest hover:bg-red-500/10 disabled:opacity-40"><Square className="w-3 h-3" />Stop</button>
        </>
      ) : (
        <>
          <input aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="project" className="w-24 border border-border bg-background px-2 py-1 text-xs" />
          <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="note" className="w-28 border border-border bg-background px-2 py-1 text-xs" />
          <button type="button" onClick={() => { if (projectId.trim()) start.mutate({ projectId: projectId.trim(), ...(note.trim() ? { note: note.trim() } : {}) }); }} disabled={!projectId.trim() || start.isPending} data-testid="timer-start" aria-label="Start timer" className="inline-flex items-center gap-1 border border-primary bg-primary text-primary-foreground px-2 py-1 text-xs font-black uppercase tracking-widest disabled:opacity-40"><Play className="w-3 h-3" />Start</button>
        </>
      )}
    </div>
  );
}
